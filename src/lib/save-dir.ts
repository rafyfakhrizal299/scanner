import { useSyncExternalStore } from "react";

/**
 * Folder simpan tetap (File System Access API).
 * Handle direktori dipersist di IndexedDB sehingga pilihan user bertahan
 * antar sesi; izin bisa diminta ulang lewat tombol (butuh gesture klik).
 */

export type SaveDirPermission = "granted" | "prompt" | "denied";

export type SaveDirState = {
  handle: DirectoryHandleLike | null;
  permission: SaveDirPermission;
  ready: boolean;
};

const HANDLE_KEY = "saveDir";
let state: SaveDirState = { handle: null, permission: "prompt", ready: false };
let loading = false;
let dbPromise: Promise<IDBDatabase> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function openKv(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB tidak tersedia"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("packscan-meta", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("kv")) {
          db.createObjectStore("kv");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Gagal membuka IndexedDB"));
    });
  }
  return dbPromise;
}

async function kvGet(key: string): Promise<unknown> {
  const db = await openKv();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readonly");
    const request = tx.objectStore("kv").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Gagal membaca IndexedDB"));
  });
}

async function kvPut(key: string, value: unknown) {
  const db = await openKv();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Gagal menulis ke IndexedDB"));
  });
}

async function kvDelete(key: string) {
  const db = await openKv();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Gagal menghapus dari IndexedDB"));
  });
}

export function subscribeSaveDir(listener: () => void): () => void {
  listeners.add(listener);
  void loadSaveDir();
  return () => {
    listeners.delete(listener);
  };
}

export function getSaveDirState(): SaveDirState {
  return state;
}

export function getServerSaveDirState(): SaveDirState {
  return { handle: null, permission: "prompt", ready: false };
}

async function loadSaveDir() {
  if (state.ready || loading) return;
  loading = true;
  let handle: DirectoryHandleLike | null = null;
  let permission: SaveDirPermission = "prompt";
  try {
    if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
      const stored = (await kvGet(HANDLE_KEY)) as DirectoryHandleLike | undefined;
      if (stored) {
        handle = stored;
        permission = await stored.queryPermission({ mode: "readwrite" });
      }
    }
  } catch {
    handle = null;
  }
  loading = false;
  state = { handle, permission, ready: true };
  notify();
}

export type PickResult = { ok: boolean; message?: string };

export async function pickSaveDirectory(): Promise<PickResult> {
  if (typeof window === "undefined" || !window.showDirectoryPicker) {
    return {
      ok: false,
      message:
        "Browser tidak menyediakan akses folder — buka aplikasi via http://localhost atau gunakan Chrome/Edge/Brave terbaru.",
    };
  }
  try {
    const handle = await window.showDirectoryPicker({
      id: "packscan-save",
      mode: "readwrite",
    });
    const permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      state = { handle: null, permission: "denied", ready: true };
      notify();
      return {
        ok: false,
        message:
          "Izin menulis ke folder ditolak — beri izin di pengaturan situs (File editing).",
      };
    }
    await kvPut(HANDLE_KEY, handle).catch(() => {});
    state = { handle, permission: "granted", ready: true };
    notify();
    return { ok: true };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false };
    }
    if (err instanceof DOMException && err.name === "SecurityError") {
      return {
        ok: false,
        message:
          "Akses folder diblokir browser — izinkan di pengaturan situs (File editing) lalu coba lagi.",
      };
    }
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Gagal membuka dialog folder.",
    };
  }
}

export async function reconnectSaveDirectory(): Promise<PickResult> {
  const handle = state.handle;
  if (!handle) return pickSaveDirectory();
  try {
    const permission = await handle.requestPermission({ mode: "readwrite" });
    state = { ...state, permission };
    notify();
    if (permission === "granted") return { ok: true };
    return {
      ok: false,
      message:
        "Izin belum diberikan — cek pengaturan situs (File editing) di browser.",
    };
  } catch {
    return {
      ok: false,
      message:
        "Izin gagal diminta — cek pengaturan situs (File editing) di browser.",
    };
  }
}

export async function clearSaveDirectory() {
  await kvDelete(HANDLE_KEY).catch(() => {});
  state = { ...state, handle: null, permission: "prompt" };
  notify();
}

export function formatDateFolder(date = new Date()): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/**
 * Tulis berkas ke folder terpilih, di dalam subfolder tanggal (auto-generate).
 * Mengembalikan path relatif untuk notifikasi, atau null bila folder siap.
 */
export async function saveIntoSaveDirectory(
  recording: { filename: string },
  blob: Blob
): Promise<{ folder: string } | null> {
  const handle = state.handle;
  if (!handle || state.permission !== "granted") return null;
  const dateFolder = formatDateFolder();
  const dir = await handle.getDirectoryHandle(dateFolder, { create: true });
  const file = await dir.getFileHandle(recording.filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
  return { folder: `${handle.name}/${dateFolder}` };
}

export function useSaveDirState(): SaveDirState {
  return useSyncExternalStore(
    subscribeSaveDir,
    getSaveDirState,
    getServerSaveDirState
  );
}
