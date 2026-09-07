export type Session = {
  user: string;
  loginAt: string;
  offlineSince?: string;
};

const KEY = "packscan.session";

// Cache agar snapshot dari useSyncExternalStore stabil (Object.is).
let cache: Session | null | undefined;

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  if (cache !== undefined) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      cache = null;
      return cache;
    }
    const parsed = JSON.parse(raw) as Session;
    cache =
      parsed && typeof parsed.user === "string" && parsed.user ? parsed : null;
  } catch {
    cache = null;
  }
  return cache;
}

export function setSession(session: Session) {
  cache = session;
  window.localStorage.setItem(KEY, JSON.stringify(session));
}

export function markOfflineSession() {
  const session = getSession();
  if (!session) return;
  setSession({ ...session, offlineSince: new Date().toISOString() });
}

export function clearSession() {
  cache = null;
  window.localStorage.removeItem(KEY);
}

/** Snapshot localStorage tidak berubah secara reaktif dalam satu tab. */
export function subscribeSession() {
  return () => {};
}
