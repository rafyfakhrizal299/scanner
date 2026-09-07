"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  Download,
  History,
  Loader2,
  ScanLine,
  Trash2,
  Video,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { fmtBytes, fmtClock, fmtDuration } from "@/lib/format";
import {
  clearRecordings,
  getRecordingsState,
  getServerRecordingsState,
  removeRecording,
  subscribeRecordings,
  triggerDownload,
  type Recording,
} from "@/lib/recordings";
import { getSession, subscribeSession } from "@/lib/session";

function getHydrated() {
  return true;
}

function getServerHydrated() {
  return false;
}

function HistoryItem({ item }: { item: Recording }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-panel p-2.5">
      {item.kind === "video" ? (
        <video
          src={item.url}
          muted
          playsInline
          preload="metadata"
          className="h-14 w-24 shrink-0 rounded-lg border border-line bg-black object-cover"
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={item.url}
          alt={`Screenshot ${item.resi}`}
          className="h-14 w-24 shrink-0 rounded-lg border border-line bg-black object-cover"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm font-bold tracking-wider text-foreground">
          {item.resi}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-muted">
          {item.kind === "video" ? "Video" : "Screenshot"} • {fmtClock(item.savedAt)} •{" "}
          {item.kind === "video" ? `${fmtDuration(item.duration)} • ` : ""}
          {fmtBytes(item.size)} •{" "}
          <span className="font-mono">{item.ext.toUpperCase()}</span>
        </p>
      </div>

      {item.saved ? (
        <span className="hidden items-center gap-1 text-[11px] font-semibold text-accent sm:flex">
          <CircleCheck className="size-3.5" />
          Tersimpan
        </span>
      ) : (
        <span className="hidden text-[11px] font-semibold text-amberish sm:block">
          Menunggu simpan
        </span>
      )}

      <button
        title="Unduh"
        onClick={() => triggerDownload(item)}
        className="rounded-lg border border-line p-2 text-muted transition-colors hover:border-accent/50 hover:text-accent"
      >
        <Download className="size-4" />
      </button>
      <button
        title="Hapus dari perangkat"
        onClick={() => {
          if (
            window.confirm(
              `Hapus ${item.kind === "video" ? "rekaman" : "screenshot"} ${item.resi} dari perangkat ini?`
            )
          ) {
            removeRecording(item.id);
          }
        }}
        className="rounded-lg border border-line p-2 text-muted transition-colors hover:border-rec/50 hover:text-rec"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}

export default function RiwayatPage() {
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribeSession,
    getHydrated,
    getServerHydrated
  );
  const session = useSyncExternalStore(subscribeSession, getSession, () => null);
  const { items, ready } = useSyncExternalStore(
    subscribeRecordings,
    getRecordingsState,
    getServerRecordingsState
  );

  useEffect(() => {
    if (hydrated && !session) router.replace("/login");
  }, [hydrated, session, router]);

  if (!session) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3">
        <Loader2 className="size-6 animate-spin text-muted" />
        <noscript>
          <p className="rounded-xl border border-rec/40 bg-rec/10 px-3 py-2.5 text-center text-xs text-rec">
            Aplikasi ini membutuhkan JavaScript dan browser modern (Chrome
            terbaru).
          </p>
        </noscript>
      </main>
    );
  }

  const totalSize = items.reduce((acc, item) => acc + item.size, 0);

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader user={session.user} />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 lg:px-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-lg border border-accent/30 bg-panel">
                <History className="size-[18px] text-accent" />
              </div>
              <div className="leading-tight">
                <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-foreground">
                  Riwayat Rekaman
                </h1>
                <p className="mt-0.5 text-[11px] text-muted">
                  {items.length} item • {fmtBytes(totalSize)} tersimpan di perangkat
                </p>
              </div>
            </div>
            {items.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm("Hapus semua riwayat dari perangkat ini?")) {
                    clearRecordings();
                  }
                }}
                className="rounded-xl border border-line bg-panel px-3.5 py-2 text-xs font-semibold text-muted transition-colors hover:border-rec/50 hover:text-rec"
              >
                Bersihkan Semua
              </button>
            )}
          </div>

          {!ready ? (
            <div className="flex items-center justify-center rounded-2xl border border-line bg-panel px-4 py-16">
              <Loader2 className="size-6 animate-spin text-muted" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
              <Video className="mx-auto size-8 text-muted/60" />
              <p className="mt-3 text-sm font-semibold text-foreground">
                Belum ada rekaman
              </p>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
                Video dan screenshot yang diambil akan muncul di sini dan
                tersimpan di perangkat.
              </p>
              <Link
                href="/scan"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-[#05261a] transition-all hover:brightness-110 active:scale-[0.98]"
              >
                <ScanLine className="size-4" />
                Mulai Scan
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {items.map((item) => (
                <HistoryItem key={item.id} item={item} />
              ))}
            </ul>
          )}

          <p className="mt-4 text-[10px] leading-relaxed text-muted/70">
            Media juga disimpan sebagai cadangan di penyimpanan lokal
            perangkat (IndexedDB) agar tidak hilang saat halaman dimuat ulang.
            Unduh berkas ke disk untuk arsip permanen.
          </p>
        </div>
      </main>
    </div>
  );
}
