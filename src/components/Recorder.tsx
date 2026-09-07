"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Camera,
  CameraOff,
  CircleCheck,
  FolderCog,
  FolderOpen,
  FolderSync,
  Info,
  Loader2,
  Mic,
  MicOff,
  Play,
  ScanBarcode,
  ScanLine,
  SlidersHorizontal,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import { fmtBytes, fmtDuration, slugResi, stampDate } from "@/lib/format";
import {
  addRecording,
  markSaved as markRecordingSaved,
  triggerDownload as downloadMedia,
  type Recording,
} from "@/lib/recordings";
import {
  clearSaveDirectory,
  formatDateFolder,
  pickSaveDirectory,
  reconnectSaveDirectory,
  saveIntoSaveDirectory,
  useSaveDirState,
} from "@/lib/save-dir";

type Phase = "idle" | "recording" | "saving";
type CamStatus = "connecting" | "live" | "denied" | "error";
type NoticeState = { kind: "error" | "ok" | "info"; text: string };
type SaveMode = "dir" | "picker" | "download";

const SAVE_MODE_KEY = "packscan.savemode";

function readSaveMode(): SaveMode {
  if (typeof window === "undefined") return "download";
  try {
    const raw = window.localStorage.getItem(SAVE_MODE_KEY);
    if (raw === "dir" || raw === "picker" || raw === "download") return raw;
  } catch {
    // ignore
  }
  return "download";
}

const BARCODE_FORMATS = [
  "code_128",
  "code_39",
  "code_93",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "codabar",
  "itf",
  "qr_code",
  "pdf_417",
  "aztec",
  "data_matrix",
];

const noopSubscribe = () => () => {};

const MEDIA_PREFS_KEY = "packscan.media";

function readMediaPrefs(): { videoId: string; audioId: string } {
  if (typeof window === "undefined") return { videoId: "", audioId: "" };
  try {
    const raw = window.localStorage.getItem(MEDIA_PREFS_KEY);
    if (!raw) return { videoId: "", audioId: "" };
    const parsed = JSON.parse(raw) as { videoId?: unknown; audioId?: unknown };
    return {
      videoId: typeof parsed.videoId === "string" ? parsed.videoId : "",
      audioId: typeof parsed.audioId === "string" ? parsed.audioId : "",
    };
  } catch {
    return { videoId: "", audioId: "" };
  }
}

function persistMediaPrefs(videoId: string, audioId: string) {
  try {
    window.localStorage.setItem(
      MEDIA_PREFS_KEY,
      JSON.stringify({ videoId, audioId })
    );
  } catch {
    // Penyimpanan diblokir — pilihan hanya berlaku di sesi ini.
  }
}

function getBarcodeSupported() {
  return "BarcodeDetector" in window;
}

function getServerBarcodeSupported() {
  return false;
}

function pickMime(): { mime: string; ext: string } {
  // H.264 diprioritaskan agar remux ke MP4 bisa tanpa re-encode.
  const candidates = [
    { mime: 'video/webm;codecs="h264,opus"', ext: "webm" },
    { mime: 'video/webm;codecs="vp9,opus"', ext: "webm" },
    { mime: 'video/webm;codecs="vp8,opus"', ext: "webm" },
    { mime: "video/webm", ext: "webm" },
    { mime: 'video/mp4;codecs="avc1,mp4a.40.2"', ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
  ];
  if (typeof MediaRecorder === "undefined") return { mime: "", ext: "webm" };
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate.mime)) return candidate;
  }
  return { mime: "", ext: "webm" };
}

/**
 * Browser (Chrome/Firefox) hanya bisa merekam ke kontainer WebM, sedangkan
 * MP4 lebih universal. Konversi dilakukan lokal lewat mediabunny:
 * video disalin apa adanya bila codec kompatibel (H.264 — instan), audio
 * di-encode ulang ke AAC agar hasilnya bisa diputar di mana saja.
 * Gagal? Coba remux apa adanya, lalu kembalikan null (pakai WebM).
 */
async function remuxToMp4(blob: Blob): Promise<Blob | null> {
  const attempts: { audio?: { codec: "aac"; bitrate: number } }[] = [
    { audio: { codec: "aac", bitrate: 128_000 } },
    {},
  ];
  for (const options of attempts) {
    try {
      const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(blob),
      });
      const target = new BufferTarget();
      const output = new Output({
        format: new Mp4OutputFormat({ fastStart: "in-memory" }),
        target,
      });
      const conversion = await Conversion.init({ input, output, ...options });
      await conversion.execute();
      const buffer = target.buffer;
      if (buffer && buffer.byteLength > 0) {
        return new Blob([buffer], { type: "video/mp4" });
      }
    } catch {
      // Strategi berikutnya.
    }
  }
  return null;
}

/**
 * Watermark (resi + timestamp) digambar langsung ke canvas sehingga tampil
 * di preview dan ikut terekam ke dalam berkas video.
 */
function drawWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  resi: string
) {
  const pad = Math.round(height * 0.03);
  const fontSize = Math.max(14, Math.round(height * 0.04));
  const now = new Date();
  const p = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;

  ctx.font = `600 ${fontSize}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = "middle";

  const bars: { text: string; align: "left" | "right" }[] = [
    { text: `RESI ${resi || "-"}`, align: "left" },
    { text: stamp, align: "right" },
  ];

  for (const bar of bars) {
    const textWidth = ctx.measureText(bar.text).width;
    const barWidth = textWidth + pad * 2.2;
    const barHeight = fontSize * 1.9;
    const x = bar.align === "left" ? pad : width - pad - barWidth;
    const y = height - pad - barHeight;
    ctx.fillStyle = "rgba(7, 9, 13, 0.62)";
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(bar.text, x + pad * 1.1, y + barHeight / 2 + 1);
  }
}

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
        checked ? "border-accent/60 bg-accent/25" : "border-line bg-background"
      } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-[3px] size-[18px] rounded-full transition-all ${
          checked ? "left-[22px] bg-accent" : "left-[3px] bg-muted"
        }`}
      />
    </button>
  );
}

function NoticeBanner({ notice }: { notice: NoticeState | null }) {
  if (!notice) return null;
  const styles: Record<NoticeState["kind"], string> = {
    error: "border-rec/40 bg-rec/10 text-rec",
    ok: "border-accent/40 bg-accent-dim text-accent",
    info: "border-amberish/40 bg-amberish/10 text-amberish",
  };
  const Icon =
    notice.kind === "error" ? TriangleAlert : notice.kind === "ok" ? CircleCheck : Info;
  return (
    <div
      className={`rise flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${styles[notice.kind]}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{notice.text}</span>
    </div>
  );
}

export default function Recorder() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bytesRef = useRef(0);
  const mimeRef = useRef({ mime: "", ext: "webm" });
  const startedAtRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const activeResiRef = useRef("");
  const saveModeRef = useRef<SaveMode>("download");
  const videoDeviceIdRef = useRef("");
  const audioDeviceIdRef = useRef("");
  const lastScanRef = useRef({ value: "", at: 0 });
  const finalizeRef = useRef<() => void>(() => {});
  const scanHandlerRef = useRef<(value: string) => void>(() => {});

  const [camStatus, setCamStatus] = useState<CamStatus>("connecting");
  const [camError, setCamError] = useState("");
  const [micOff, setMicOff] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeResi, setActiveResi] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [saveMode, setSaveMode] = useState<SaveMode>(() => readSaveMode());
  const [, setProbeTick] = useState(0);
  const [barcodeOn, setBarcodeOn] = useState(false);
  const saveDir = useSaveDirState();
  const dirPickerSupported = useSyncExternalStore(
    noopSubscribe,
    () => "showDirectoryPicker" in window,
    () => false
  );
  const isSecureContext = useSyncExternalStore(
    noopSubscribe,
    () => window.isSecureContext,
    () => true
  );
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState(() => readMediaPrefs().videoId);
  const [audioDeviceId, setAudioDeviceId] = useState(() => readMediaPrefs().audioId);
  const [switching, setSwitching] = useState<"video" | "audio" | null>(null);
  const barcodeSupported = useSyncExternalStore(
    noopSubscribe,
    getBarcodeSupported,
    getServerBarcodeSupported
  );

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(devices.filter((device) => device.kind === "videoinput"));
      setAudioDevices(devices.filter((device) => device.kind === "audioinput"));
    } catch {
      // Enumerasi gagal — perangkat default tetap bisa dipakai.
    }
  }, []);

  const connectCamera = useCallback(async () => {
    // Jeda satu microtask agar effect tidak memicu setState sinkron (render berantai).
    await Promise.resolve();
    if (!window.isSecureContext) {
      const port = window.location.port ? `:${window.location.port}` : "";
      setCamStatus("error");
      setCamError(
        `Kamera & mikrofon butuh HTTPS. Buka https://${window.location.hostname}${port} lalu terima peringatan sertifikat — akses via http:// tidak akan memunculkan izin kamera.`
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamStatus("error");
      setCamError("Browser ini tidak mendukung akses kamera.");
      return;
    }
    setCamStatus("connecting");
    setCamError("");
    const videoId = videoDeviceIdRef.current;
    const audioId = audioDeviceIdRef.current;
    const videoBase = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const videoConstraint = videoId
      ? { deviceId: { exact: videoId }, ...videoBase }
      : videoBase;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraint,
          audio: audioId ? { deviceId: { exact: audioId } } : true,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") throw err;
        if (err instanceof DOMException && err.name === "OverconstrainedError") {
          // Perangkat tersimpan tidak tersedia — pakai default.
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoBase,
            audio: true,
          });
        } else {
          // Mic mungkin tidak tersedia — coba kamera saja.
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraint,
            audio: false,
          });
        }
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          // Autoplay ditahan browser — elemen tetap menampilkan frame pertama.
        }
      }
      const canvas = canvasRef.current;
      canvasStreamRef.current = canvas ? canvas.captureStream(30) : null;
      const onLost = () => {
        if (streamRef.current !== stream) return;
        streamRef.current = null;
        canvasStreamRef.current = null;
        setCamStatus("error");
        setCamError("Koneksi kamera terputus.");
        const recorder = recorderRef.current;
        if (recorder && recorder.state === "recording") {
          setNotice({
            kind: "error",
            text: "Kamera terputus — rekaman yang sudah berjalan tetap disimpan.",
          });
          recorder.stop();
        }
      };
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", onLost);
      });
      setMicOff(stream.getAudioTracks().length === 0);
      setCamStatus("live");
      // Sinkronkan pilihan dengan perangkat yang benar-benar aktif.
      const actualVideoId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      const actualAudioId = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (actualVideoId) setVideoDeviceId(actualVideoId);
      if (actualAudioId) setAudioDeviceId(actualAudioId);
      persistMediaPrefs(
        actualVideoId ?? videoDeviceIdRef.current,
        actualAudioId ?? audioDeviceIdRef.current
      );
      void refreshDevices();
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") {
        setCamStatus("error");
        setCamError("Kamera tidak ditemukan pada perangkat ini.");
      } else if (err instanceof DOMException && err.name === "NotAllowedError") {
        setCamStatus("denied");
      } else {
        setCamStatus("error");
        setCamError(
          err instanceof Error ? err.message : "Gagal mengakses kamera."
        );
      }
    }
  }, [refreshDevices]);

  /** Ganti kamera / mikrofon saat live — track lama dilepas, yang baru dipasang. */
  async function handleDeviceChange(kind: "video" | "audio", deviceId: string) {
    const prevId = kind === "video" ? videoDeviceIdRef.current : audioDeviceIdRef.current;
    if (deviceId === prevId) return;
    if (kind === "video") setVideoDeviceId(deviceId);
    else setAudioDeviceId(deviceId);
    persistMediaPrefs(
      kind === "video" ? deviceId : videoDeviceIdRef.current,
      kind === "audio" ? deviceId : audioDeviceIdRef.current
    );
    const base = streamRef.current;
    if (!base) return; // belum live — cukup simpan preferensi

    setSwitching(kind);
    try {
      const constraints: MediaStreamConstraints =
        kind === "video"
          ? {
              video: {
                deviceId: { exact: deviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
              audio: false,
            }
          : { video: false, audio: { deviceId: { exact: deviceId } } };
      const replacement = await navigator.mediaDevices.getUserMedia(constraints);
      base.getTracks()
        .filter((track) => track.kind === kind)
        .forEach((track) => {
          base.removeTrack(track);
          track.stop();
        });
      replacement.getTracks().forEach((track) => base.addTrack(track));
      if (kind === "video") {
        const video = videoRef.current;
        if (video) {
          video.srcObject = base;
          try {
            await video.play();
          } catch {
            // Autoplay ditahan browser.
          }
        }
      }
      setMicOff(base.getAudioTracks().length === 0);
      setNotice({
        kind: "ok",
        text: kind === "video" ? "Kamera diganti." : "Mikrofon diganti.",
      });
    } catch (err) {
      if (kind === "video") setVideoDeviceId(prevId);
      else setAudioDeviceId(prevId);
      persistMediaPrefs(
        kind === "video" ? prevId : videoDeviceIdRef.current,
        kind === "video" ? audioDeviceIdRef.current : prevId
      );
      setNotice({
        kind: "error",
        text: `Gagal mengganti ${kind === "video" ? "kamera" : "mikrofon"}: ${
          err instanceof Error ? err.message : "tidak diketahui"
        }`,
      });
    } finally {
      setSwitching(null);
    }
  }

  function changeSaveMode(mode: SaveMode) {
    setSaveMode(mode);
    try {
      window.localStorage.setItem(SAVE_MODE_KEY, mode);
    } catch {
      // ignore
    }
  }

  function handlePickFolder() {
    void pickSaveDirectory().then((result) => {
      if (result.ok) {
        setNotice({
          kind: "ok",
          text: "Folder tersambung — subfolder tanggal dibuat otomatis.",
        });
      } else if (result.message) {
        setNotice({ kind: "error", text: result.message });
      }
    });
  }

  function handleReconnectFolder() {
    void reconnectSaveDirectory().then((result) => {
      if (result.ok) {
        setNotice({ kind: "ok", text: "Izin folder tersambung kembali." });
      } else if (result.message) {
        setNotice({ kind: "error", text: result.message });
      }
    });
  }

  async function saveRecording(recording: Recording, blob: Blob) {
    const label = recording.kind === "image" ? "Screenshot" : "Video";
    const mode = saveModeRef.current;

    // Folder tetap + subfolder per tanggal (File System Access API).
    if (mode === "dir" && dirPickerSupported) {
      try {
        const result = await saveIntoSaveDirectory(recording, blob);
        if (result) {
          markRecordingSaved(recording.id);
          setNotice({
            kind: "ok",
            text: `${label} ${recording.resi} tersimpan ke ${result.folder}.`,
          });
          return;
        }
      } catch (err) {
        downloadMedia(recording);
        markRecordingSaved(recording.id);
        setNotice({
          kind: "error",
          text: `Gagal menulis ke folder: ${
            err instanceof Error ? err.message : "tidak diketahui"
          } — diunduh ke Downloads.`,
        });
        return;
      }
      downloadMedia(recording);
      markRecordingSaved(recording.id);
      setNotice({
        kind: "info",
        text: "Folder simpan belum terhubung — diunduh ke Downloads. Sambungkan di Pengaturan Penyimpanan.",
      });
      return;
    }

    try {
      if (mode === "picker" && window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: recording.filename,
          types: [
            {
              description:
                recording.kind === "image"
                  ? "Screenshot packing"
                  : "Rekaman video packing",
              accept: { [recording.mime]: [`.${recording.ext}`] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        markRecordingSaved(recording.id);
        setNotice({
          kind: "ok",
          text: `${label} ${recording.resi} tersimpan ke lokasi pilihanmu.`,
        });
      } else {
        downloadMedia(recording);
        markRecordingSaved(recording.id);
        setNotice({
          kind: "ok",
          text: `${label} ${recording.resi} tersimpan ke folder Downloads.`,
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setNotice({
          kind: "info",
          text: "Penyimpanan dibatalkan — masih bisa diunduh dari halaman Riwayat.",
        });
        return;
      }
      downloadMedia(recording);
      markRecordingSaved(recording.id);
      setNotice({
        kind: "info",
        text: "Dialog simpan tidak tersedia — diunduh otomatis ke Downloads.",
      });
    }
  }

  async function finalizeRecording() {
    const resi = activeResiRef.current;
    const duration = (Date.now() - startedAtRef.current) / 1000;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    const { mime, ext } = mimeRef.current;
    const sourceType = mime.split(";")[0] || "video/webm";
    let blob = new Blob(chunks, { type: sourceType });
    let finalExt = ext;
    let finalMime = sourceType;
    recorderRef.current = null;

    if (!resi || blob.size === 0) {
      setPhase("idle");
      setActiveResi("");
      setElapsed(0);
      setNotice({ kind: "error", text: "Rekaman kosong — tidak ada yang disimpan." });
      inputRef.current?.focus();
      return;
    }

    // Konversi ke MP4 (universal) bila browser merekam ke WebM.
    if (sourceType !== "video/mp4") {
      setNotice({ kind: "info", text: "Memproses video ke MP4…" });
      const mp4 = await remuxToMp4(blob);
      if (mp4) {
        blob = mp4;
        finalExt = "mp4";
        finalMime = "video/mp4";
      } else {
        setNotice({
          kind: "info",
          text: "Konversi MP4 tidak didukung browser ini — disimpan sebagai WebM.",
        });
      }
    }

    const recording = addRecording(
      {
        kind: "video",
        resi,
        filename: `RESI-${resi}-${stampDate()}.${finalExt}`,
        size: blob.size,
        duration,
        mime: finalMime,
        ext: finalExt,
      },
      blob
    );
    setPhase("idle");
    setActiveResi("");
    setElapsed(0);
    setBytes(0);
    inputRef.current?.focus();
    await saveRecording(recording, blob);
  }

  async function startRecording(raw: string) {
    const resi = slugResi(raw);
    if (!resi) {
      setNotice({ kind: "error", text: "Scan atau input nomor resi terlebih dahulu." });
      inputRef.current?.focus();
      return;
    }
    if (!streamRef.current) {
      setNotice({ kind: "info", text: "Kamera belum terhubung — menghubungkan…" });
      await connectCamera();
      if (!streamRef.current) {
        setNotice({
          kind: "error",
          text: "Kamera tidak bisa dihubungkan. Periksa izin kamera lalu coba lagi.",
        });
        return;
      }
    }
    const stream = streamRef.current;
    const picked = pickMime();
    mimeRef.current = picked;
    chunksRef.current = [];
    bytesRef.current = 0;
    // Video direkam dari canvas (ber-watermark) + audio asli dari mikrofon.
    const canvasTracks = canvasStreamRef.current?.getVideoTracks() ?? [];
    const recordStream =
      canvasTracks.length > 0
        ? new MediaStream([...canvasTracks, ...stream.getAudioTracks()])
        : new MediaStream(stream.getTracks());
    try {
      const recorder = new MediaRecorder(
        recordStream,
        picked.mime
          ? {
              mimeType: picked.mime,
              videoBitsPerSecond: 2_500_000,
              audioBitsPerSecond: 128_000,
            }
          : undefined
      );
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          bytesRef.current += event.data.size;
        }
      };
      recorder.onstop = () => {
        void finalizeRef.current();
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setActiveResi(resi);
      setPhase("recording");
      setInputValue("");
      setNotice(null);
    } catch (err) {
      setNotice({
        kind: "error",
        text: `Gagal memulai rekaman: ${
          err instanceof Error ? err.message : "penyebab tidak diketahui"
        }`,
      });
    }
  }

  function requestStop(raw: string) {
    const resi = slugResi(raw);
    if (!resi) {
      setNotice({
        kind: "error",
        text: `Scan resi ${activeResiRef.current} sekali lagi untuk stop & simpan.`,
      });
      inputRef.current?.focus();
      return;
    }
    if (resi !== activeResiRef.current) {
      setNotice({
        kind: "error",
        text: `Resi berbeda! Sedang merekam ${activeResiRef.current} — scan resi yang sama untuk stop.`,
      });
      setInputValue("");
      inputRef.current?.focus();
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setPhase("saving");
    setNotice(null);
    try {
      recorder.stop();
    } catch {
      void finalizeRef.current();
    }
  }

  function takeScreenshot() {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width || !canvas.height) {
      setNotice({ kind: "error", text: "Kamera belum siap — coba lagi sebentar." });
      return;
    }
    canvas.toBlob(
      (raw) => {
        if (!raw) {
          setNotice({ kind: "error", text: "Gagal mengambil screenshot." });
          return;
        }
        const blob = new Blob([raw], { type: "image/jpeg" });
        const resi =
          phaseRef.current === "recording"
            ? activeResiRef.current
            : slugResi(inputValue) || "TANPA-RESI";
        const recording = addRecording(
          {
            kind: "image",
            resi,
            filename: `FOTO-${resi}-${stampDate()}.jpg`,
            size: blob.size,
            duration: 0,
            mime: "image/jpeg",
            ext: "jpg",
          },
          blob
        );
        void saveRecording(recording, blob);
      },
      "image/jpeg",
      0.92
    );
  }

  /**
   * ====== PINTU MASUK SCANNER ======
   * Semua sumber scan bermuara ke startViaScanner / stopViaScanner:
   * - BarcodeDetector (kamera)
   * - Scanner USB/Bluetooth keyboard-wedge via kolom resi (Enter)
   * - Listener global keyboard-wedge (saat fokus di luar kolom)
   * Nanti kalau scanner datang via SDK/serial, cukup panggil
   * startViaScanner(nilai) dari sana.
   */

  /** Scan → mulai rekam. Kamera auto-connect bila belum live. */
  function startViaScanner(rawValue: string) {
    const value = slugResi(rawValue);
    if (!value) {
      setNotice({ kind: "error", text: "Nilai scan tidak valid / kosong." });
      return;
    }
    void startRecording(value);
  }

  /** Scan → stop & simpan bila cocok dengan resi yang sedang terekam. */
  function stopViaScanner(rawValue: string) {
    requestStop(rawValue);
  }

  function handleScannedValue(rawValue: string) {
    const value = slugResi(rawValue);
    if (!value) return;
    const now = Date.now();
    if (lastScanRef.current.value === value && now - lastScanRef.current.at < 2500) {
      return;
    }
    lastScanRef.current = { value, at: now };
    setInputValue(value);
    if (phaseRef.current === "recording") {
      stopViaScanner(value);
    } else if (phaseRef.current === "idle") {
      startViaScanner(value);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (phase === "saving") return;
    if (phase === "recording") requestStop(inputValue);
    else void startRecording(inputValue);
  }

  // Sinkronisasi ref agar closure (MediaRecorder / barcode loop) selalu memakai nilai terbaru.
  useEffect(() => {
    phaseRef.current = phase;
    activeResiRef.current = activeResi;
    saveModeRef.current = saveMode;
    videoDeviceIdRef.current = videoDeviceId;
    audioDeviceIdRef.current = audioDeviceId;
    finalizeRef.current = () => void finalizeRecording();
    scanHandlerRef.current = handleScannedValue;
  });

  // Daftar perangkat menyala/mati — muat ulang daftarnya.
  useEffect(() => {
    const list = navigator.mediaDevices;
    if (!list?.addEventListener) return;
    list.addEventListener("devicechange", refreshDevices);
    return () => list.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  useEffect(() => {
    const id = window.setTimeout(() => void connectCamera(), 0);
    return () => window.clearTimeout(id);
  }, [connectCamera]);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = window.setInterval(() => {
      setElapsed((Date.now() - startedAtRef.current) / 1000);
      setBytes(bytesRef.current);
    }, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  // Render loop: frame kamera + watermark (resi & timestamp) ke canvas.
  useEffect(() => {
    if (camStatus !== "live") return;
    let raf = 0;
    const loop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
        if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          drawWatermark(ctx, canvas.width, canvas.height, activeResiRef.current);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [camStatus]);

  useEffect(() => {
    const base = "PackScan — Stasiun Packing";
    document.title =
      phase === "recording"
        ? `● REC ${fmtDuration(elapsed)} • ${activeResi} — PackScan`
        : base;
  }, [phase, elapsed, activeResi]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(
      () => setNotice(null),
      notice.kind === "error" ? 6000 : 4000
    );
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (phaseRef.current === "recording") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Listener global scanner USB/Bluetooth (keyboard-wedge) saat fokus berada
  // di luar kolom resi: deretan keystroke cepat diakhiri Enter = hasil scan.
  useEffect(() => {
    const MIN_SCAN_LENGTH = 4;
    const SCAN_CADENCE_MS = 150;
    let buffer = "";
    let lastKeyAt = 0;

    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable);

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        buffer = "";
        return; // kolom resi menangani sendiri lewat form submit
      }
      const now = Date.now();
      if (now - lastKeyAt > SCAN_CADENCE_MS) buffer = "";
      lastKeyAt = now;
      if (event.key === "Enter") {
        const scanned = buffer;
        buffer = "";
        if (scanned.trim().length >= MIN_SCAN_LENGTH) {
          event.preventDefault();
          scanHandlerRef.current(scanned);
        }
        return;
      }
      if (event.key.length === 1) buffer += event.key;
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!barcodeOn || !barcodeSupported || camStatus !== "live") return;
    let cancelled = false;
    let timer = 0;
    const detector = new BarcodeDetector({ formats: BARCODE_FORMATS });
    const tick = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      try {
        if (video && video.readyState >= 2) {
          const found = await detector.detect(video);
          if (found.length > 0 && found[0].rawValue) {
            scanHandlerRef.current(found[0].rawValue);
          }
        }
      } catch {
        // Frame belum siap — lanjut frame berikutnya.
      }
      if (!cancelled) timer = window.setTimeout(tick, 350);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [barcodeOn, barcodeSupported, camStatus]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      canvasStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const recording = phase === "recording";

  return (
    <div className="flex w-full min-h-0 flex-1 flex-col gap-4 px-4 pb-4 pt-4 lg:flex-row lg:px-6">
      {/* ---------- Card input (kiri) ---------- */}
      <section className="flex w-full shrink-0 flex-col gap-2.5 rounded-2xl border border-line bg-panel p-4 lg:w-[360px]">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
            Panel Rekaman
          </h2>
          <span
            className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest ${
              recording
                ? "border-rec/50 bg-rec/10 text-rec"
                : "border-line bg-panel-2 text-muted"
            }`}
          >
            {phase === "idle" ? "SIAP" : phase === "recording" ? "MEREKAM" : "MENYIMPAN"}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <label htmlFor="resi" className="sr-only">
            Resi Paket
          </label>
          <input
            id="resi"
            ref={inputRef}
            autoFocus
            disabled={phase === "saving"}
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value.toUpperCase())}
            placeholder={
              recording
                ? `Scan ${activeResi} lagi untuk stop…`
                : "Scan / input resi paket…"
            }
            className="h-12 w-full rounded-xl border border-line bg-panel-2 px-4 font-mono text-base tracking-[0.15em] text-foreground transition-colors placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-muted/60 focus:border-accent/60 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={phase === "saving"}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${
              recording
                ? "bg-rec text-white hover:brightness-110"
                : "bg-accent text-[#05261a] hover:brightness-110"
            }`}
          >
            {phase === "recording" ? (
              <>
                <Square className="size-4 fill-current" />
                Stop &amp; Simpan
              </>
            ) : phase === "saving" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Menyimpan…
              </>
            ) : (
              <>
                <Play className="size-4 fill-current" />
                Mulai Rekam
              </>
            )}
          </button>
        </form>

        <div className="rounded-xl border border-line bg-panel-2/50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
            <SlidersHorizontal className="size-3.5 text-accent" />
            Sumber Media
          </p>
          <div className="flex flex-col gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted/80">
                Kamera
              </span>
              <select
                value={videoDeviceId}
                onChange={(event) => void handleDeviceChange("video", event.target.value)}
                disabled={recording || phase === "saving" || switching !== null}
                className="h-9 w-full rounded-lg border border-line bg-background px-2 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {videoDevices.length === 0 && <option value="">Kamera default</option>}
                {videoDevices.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {device.label || `Kamera ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted/80">
                Mikrofon
              </span>
              <select
                value={audioDeviceId}
                onChange={(event) => void handleDeviceChange("audio", event.target.value)}
                disabled={recording || phase === "saving" || switching !== null}
                className="h-9 w-full rounded-lg border border-line bg-background px-2 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {audioDevices.length === 0 && <option value="">Mikrofon default</option>}
                {audioDevices.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {device.label || `Mikrofon ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[10px] leading-relaxed text-muted/70">
              {recording
                ? "Sumber terkunci selama merekam."
                : switching
                  ? "Mengganti perangkat…"
                  : "Pilihan tersimpan otomatis untuk sesi berikutnya."}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-panel-2/50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
            <FolderCog className="size-3.5 text-accent" />
            Penyimpanan
          </p>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-background p-1">
            {(
              [
                ["dir", "Folder"],
                ["picker", "Pilih lokasi"],
                ["download", "Downloads"],
              ] as const
            ).map(([mode, label]) => {
              const unsupported = mode === "dir" && !dirPickerSupported;
              return (
                <span
                  key={mode}
                  title={
                    unsupported
                      ? "Tidak didukung browser ini — gunakan Chrome atau Edge"
                      : undefined
                  }
                  className="flex"
                >
                  <button
                    type="button"
                    onClick={() => changeSaveMode(mode)}
                    disabled={unsupported}
                    className={`w-full rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                      saveMode === mode
                        ? "bg-accent/15 text-accent"
                        : "text-muted hover:text-foreground"
                    } ${unsupported ? "cursor-not-allowed opacity-40" : ""}`}
                  >
                    {label}
                  </button>
                </span>
              );
            })}
          </div>

          {saveMode === "dir" && !dirPickerSupported && (
            <div className="mt-2 rounded-lg border border-amberish/40 bg-amberish/10 p-2.5">
              <p className="text-[10px] leading-relaxed text-amberish">
                {!isSecureContext
                  ? "Buka aplikasi lewat http://localhost:3000 atau HTTPS — akses folder tidak tersedia lewat IP/host biasa (http)."
                  : "Browser sedang memblokir akses folder. Matikan Shields untuk site ini lalu muat ulang, cek pengaturan situs (File editing), atau perbarui browser."}
              </p>
              <button
                type="button"
                onClick={() => setProbeTick((tick) => tick + 1)}
                className="mt-1.5 text-[10px] font-bold text-amberish underline underline-offset-2"
              >
                Deteksi ulang
              </button>
              <p className="mt-1.5 font-mono text-[10px] text-muted/80">
                showDirectoryPicker: {dirPickerSupported ? "ada" : "tidak ada"} •
                secureContext: {isSecureContext ? "ya" : "tidak"}
              </p>
              <button
                type="button"
                onClick={() => {
                  const info = JSON.stringify(
                    {
                      origin: window.location.origin,
                      isSecureContext: window.isSecureContext,
                      showDirectoryPicker: "showDirectoryPicker" in window,
                      showSaveFilePicker: "showSaveFilePicker" in window,
                      userAgent: navigator.userAgent,
                    },
                    null,
                    2
                  );
                  navigator.clipboard
                    ?.writeText(info)
                    .then(() => {
                      setNotice({
                        kind: "ok",
                        text: "Info browser tersalin — tempel di chat untuk dianalisis.",
                      });
                    })
                    .catch(() => {});
                }}
                className="mt-1 text-[10px] font-bold text-amberish underline underline-offset-2"
              >
                Salin info browser
              </button>
            </div>
          )}

          {saveMode === "dir" && (
            <div className="mt-2">
              {saveDir.handle ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-foreground">
                      {saveDir.handle.name}
                    </p>
                    <p className="text-[10px] text-muted">
                      {saveDir.permission === "granted"
                        ? "Subfolder tanggal dibuat otomatis"
                        : "Izin perlu disambungkan ulang"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {saveDir.permission === "granted" ? (
                      <button
                        type="button"
                        title="Ganti folder"
                        onClick={handlePickFolder}
                        className="rounded-lg border border-line p-1.5 text-muted transition-colors hover:border-accent/50 hover:text-accent"
                      >
                        <FolderSync className="size-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleReconnectFolder}
                        className="rounded-lg bg-accent px-2 py-1.5 text-[10px] font-bold text-[#05261a] hover:brightness-110"
                      >
                        Sambungkan
                      </button>
                    )}
                    <button
                      type="button"
                      title="Lepas folder"
                      onClick={() => void clearSaveDirectory()}
                      className="rounded-lg border border-line p-1.5 text-muted transition-colors hover:border-rec/50 hover:text-rec"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handlePickFolder}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-2.5 text-[11px] font-semibold text-muted transition-colors hover:border-accent/50 hover:text-accent"
                >
                  <FolderOpen className="size-3.5" />
                  Pilih folder simpan…
                </button>
              )}
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted/70">
                Video &amp; screenshot masuk ke subfolder per tanggal, mis.{" "}
                <span className="font-mono">{formatDateFolder()}/</span>
              </p>
            </div>
          )}
          {saveMode === "download" && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted/70">
              Otomatis terunduh ke folder Downloads browser.
            </p>
          )}
          {saveMode === "picker" && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted/70">
              Dialog pilih lokasi muncul setiap selesai rekam.
            </p>
          )}
        </div>

        {recording ? (
          <div className="rise rounded-xl border border-rec/50 bg-rec/10 px-3.5 py-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-rec">
                <span className="relative flex size-2">
                  <span className="ping-soft absolute inline-flex h-full w-full rounded-full bg-rec" />
                  <span className="relative inline-flex size-2 rounded-full bg-rec" />
                </span>
                Sedang Merekam
              </span>
              <span className="font-mono text-lg font-bold tabular-nums text-rec">
                {fmtDuration(elapsed)}
              </span>
            </div>
            <div className="mt-1 flex justify-between font-mono text-[11px] text-muted">
              <span>RESI {activeResi}</span>
              <span className="tabular-nums">{fmtBytes(bytes)}</span>
            </div>
          </div>
        ) : (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
            <ScanLine className="mt-0.5 size-3.5 shrink-0 text-accent" />
            Scanner USB/Bluetooth: pastikan kolom resi aktif — hasil scan masuk
            otomatis &amp; langsung memicu aksi mulai / stop.
          </p>
        )}

        {notice && <NoticeBanner notice={notice} />}
      </section>

      {/* ---------- Video besar di bawah card input ---------- */}
      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <div
          className={`relative min-h-0 w-full flex-1 overflow-hidden rounded-2xl border-2 bg-black transition-colors ${
            recording ? "stage-rec border-rec" : "border-line"
          }`}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 z-[1] h-full w-full object-cover"
          />

          {recording && (
            <div className="rec-vignette pointer-events-none absolute inset-0" />
          )}

          {/* Bracket merah — penanda rekaman */}
          {recording && (
            <div className="pointer-events-none absolute inset-4">
              <span className="absolute left-0 top-0 h-7 w-7 border-l-[3px] border-t-[3px] border-rec" />
              <span className="absolute right-0 top-0 h-7 w-7 border-r-[3px] border-t-[3px] border-rec" />
              <span className="absolute bottom-0 left-0 h-7 w-7 border-b-[3px] border-l-[3px] border-rec" />
              <span className="absolute bottom-0 right-0 h-7 w-7 border-b-[3px] border-r-[3px] border-rec" />
            </div>
          )}

          {camStatus === "live" && (
            <>
              {recording && (
                <div className="absolute left-7 top-7 flex items-center gap-2 rounded-md bg-rec px-2.5 py-1 font-mono text-xs font-bold tracking-[0.2em] text-white shadow-lg shadow-rec/40">
                  <span className="rec-blink size-2 rounded-full bg-white" />
                  REC
                </div>
              )}

              <div className="absolute right-7 top-7 z-[2] flex flex-col items-end gap-2">
                {recording && (
                  <div className="text-right">
                    <p className="font-mono text-2xl font-bold tabular-nums text-rec drop-shadow-[0_0_10px_rgba(255,82,82,0.6)]">
                      {fmtDuration(elapsed)}
                    </p>
                    <p className="font-mono text-[11px] tabular-nums text-white/70">
                      {fmtBytes(bytes)}
                    </p>
                  </div>
                )}
                <div
                  title={
                    micOff
                      ? "Mikrofon tidak aktif"
                      : "Preview tanpa suara — audio tetap terekam"
                  }
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-black/60 px-2.5 py-1.5 text-[11px] font-medium text-muted backdrop-blur"
                >
                  {micOff ? (
                    <>
                      <MicOff className="size-3.5 text-amberish" />
                      Tanpa mikrofon
                    </>
                  ) : (
                    <>
                      <Mic className="size-3.5 text-accent" />
                      Audio terekam
                    </>
                  )}
                </div>
              </div>

              {/* Reticle barcode */}
              {barcodeOn && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="relative h-1/2 w-1/2 max-w-[420px]">
                    <span className="absolute left-0 top-0 h-9 w-9 border-l-2 border-t-2 border-accent" />
                    <span className="absolute right-0 top-0 h-9 w-9 border-r-2 border-t-2 border-accent" />
                    <span className="absolute bottom-0 left-0 h-9 w-9 border-b-2 border-l-2 border-accent" />
                    <span className="absolute bottom-0 right-0 h-9 w-9 border-b-2 border-r-2 border-accent" />
                    <span className="scan-sweep absolute left-1 right-1 h-0.5 rounded-full bg-accent/80 shadow-[0_0_14px_rgba(61,220,151,0.9)]" />
                  </div>
                </div>
              )}
            </>
          )}

          {camStatus !== "live" && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-panel/95 px-6 text-center">
              {camStatus === "connecting" && (
                <>
                  <Loader2 className="size-8 animate-spin text-accent" />
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      Menghubungkan kamera…
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Browser akan meminta izin kamera & mikrofon.
                    </p>
                  </div>
                </>
              )}
              {camStatus === "denied" && (
                <>
                  <div className="flex size-14 items-center justify-center rounded-2xl border border-rec/40 bg-rec/10">
                    <CameraOff className="size-7 text-rec" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      Izin kamera & mikrofon ditolak
                    </p>
                    <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
                      Klik ikon kamera / gembok di address bar → izinkan
                      kamera & mikrofon → lalu tekan tombol di bawah.
                    </p>
                  </div>
                  <button
                    onClick={() => void connectCamera()}
                    className="rounded-xl bg-accent px-4 py-2 text-xs font-bold text-[#05261a] transition-all hover:brightness-110 active:scale-[0.98]"
                  >
                    Coba Hubungkan Lagi
                  </button>
                </>
              )}
              {camStatus === "error" && (
                <>
                  <div className="flex size-14 items-center justify-center rounded-2xl border border-amberish/40 bg-amberish/10">
                    <TriangleAlert className="size-7 text-amberish" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      Kamera tidak tersedia
                    </p>
                    <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
                      {camError || "Terjadi kesalahan saat mengakses kamera."}
                    </p>
                  </div>
                  <button
                    onClick={() => void connectCamera()}
                    className="rounded-xl bg-accent px-4 py-2 text-xs font-bold text-[#05261a] transition-all hover:brightness-110 active:scale-[0.98]"
                  >
                    Coba Lagi
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Kontrol bawah video */}
        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-3.5 py-2 text-xs">
              <Camera
                className={`size-4 ${camStatus === "live" ? "text-accent" : "text-muted"}`}
              />
              <span className={camStatus === "live" ? "text-foreground" : "text-muted"}>
                {camStatus === "live"
                  ? "Kamera terhubung"
                  : camStatus === "connecting"
                    ? "Menghubungkan…"
                    : "Kamera belum terhubung"}
              </span>
            </div>
            <div className="flex items-center gap-2.5 rounded-full border border-line bg-panel px-3.5 py-2 text-xs">
              <ScanBarcode className="size-4 text-accent" />
              <span className="text-foreground">Scan barcode via kamera</span>
              <Switch
                checked={barcodeOn}
                onChange={setBarcodeOn}
                disabled={!barcodeSupported || camStatus !== "live"}
              />
            </div>
            <button
              type="button"
              onClick={takeScreenshot}
              disabled={camStatus !== "live"}
              className="flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3.5 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Camera className="size-4" />
              Screenshot
            </button>
          </div>
          {!barcodeSupported && (
            <p className="px-1 text-[11px] leading-relaxed text-muted">
              Deteksi barcode via kamera belum didukung browser ini (gunakan
              Chrome/Edge). Scanner barcode USB/Bluetooth tetap berfungsi
              lewat kolom resi.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
