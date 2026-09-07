export type RecordingKind = "video" | "image";

export type Recording = {
  id: string;
  kind: RecordingKind;
  resi: string;
  filename: string;
  url: string;
  size: number;
  duration: number;
  savedAt: number;
  saved: boolean;
  mime: string;
  ext: string;
};

type StoredRecord = Omit<Recording, "url"> & { blob: Blob };

type RecordingsState = { items: Recording[]; ready: boolean };

const DB_NAME = "packscan";
const STORE = "recordings";

const blobs = new Map<string, Blob>();
let state: RecordingsState = { items: [], ready: false };
let hydrating = false;
let dbPromise: Promise<IDBDatabase> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function setItems(items: Recording[]) {
  state = { ...state, items };
  notify();
}

/* ---------- IndexedDB helpers (backup media di perangkat) ---------- */

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB tidak tersedia"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Gagal membuka IndexedDB"));
    });
  }
  return dbPromise;
}

async function putRecord(record: StoredRecord) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Gagal menyimpan ke IndexedDB"));
    tx.onabort = () => reject(tx.error ?? new Error("Penyimpanan dibatalkan"));
  });
}

async function getAllRecords(): Promise<StoredRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as StoredRecord[]);
    request.onerror = () => reject(request.error ?? new Error("Gagal membaca IndexedDB"));
  });
}

async function deleteRecord(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Gagal menghapus dari IndexedDB"));
  });
}

async function clearStore() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Gagal membersihkan IndexedDB"));
  });
}

/* ---------- Hydration ---------- */

async function ensureHydrated() {
  if (state.ready || hydrating) return;
  hydrating = true;
  try {
    const records = await getAllRecords();
    const items = records
      .map(({ blob, ...meta }) => {
        blobs.set(meta.id, blob);
        return { ...meta, url: URL.createObjectURL(blob) };
      })
      .sort((a, b) => b.savedAt - a.savedAt);
    state = { items, ready: true };
    notify();
  } catch {
    state = { items: [], ready: true };
    notify();
  } finally {
    hydrating = false;
  }
}

/* ---------- Public API ---------- */

export function subscribeRecordings(listener: () => void): () => void {
  listeners.add(listener);
  void ensureHydrated();
  return () => {
    listeners.delete(listener);
  };
}

export function getRecordingsState(): RecordingsState {
  return state;
}

export function getServerRecordingsState(): RecordingsState {
  return { items: [], ready: false };
}

export function addRecording(
  meta: {
    kind: RecordingKind;
    resi: string;
    filename: string;
    size: number;
    duration: number;
    mime: string;
    ext: string;
  },
  blob: Blob
): Recording {
  const item: Recording = {
    ...meta,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: URL.createObjectURL(blob),
    savedAt: Date.now(),
    saved: false,
  };
  blobs.set(item.id, blob);
  setItems([item, ...state.items]);
  void putRecord({ ...item, blob }).catch(() => {
    // Backup IndexedDB gagal — media tetap tersedia di memori sesi ini.
  });
  return item;
}

export function markSaved(id: string) {
  const items = state.items.map((item) =>
    item.id === id ? { ...item, saved: true } : item
  );
  setItems(items);
  const updated = items.find((item) => item.id === id);
  const blob = blobs.get(id);
  if (updated && blob) {
    void putRecord({ ...updated, blob }).catch(() => {});
  }
}

export function removeRecording(id: string) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  URL.revokeObjectURL(item.url);
  blobs.delete(id);
  setItems(state.items.filter((entry) => entry.id !== id));
  void deleteRecord(id).catch(() => {});
}

export function clearRecordings() {
  state.items.forEach((item) => URL.revokeObjectURL(item.url));
  blobs.clear();
  setItems([]);
  void clearStore().catch(() => {});
}

export function triggerDownload(recording: Recording) {
  const anchor = document.createElement("a");
  anchor.href = recording.url;
  anchor.download = recording.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
