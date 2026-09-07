"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole, TriangleAlert, WifiOff } from "lucide-react";
import { subscribeOnline } from "@/lib/online";
import { getSession, setSession, subscribeSession } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const session = useSyncExternalStore(subscribeSession, getSession, () => null);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Penanda bahwa bundle React berhasil berjalan (dipakai inline script di bawah).
  useEffect(() => {
    window.__PACKSCAN_HYDRATED = true;
    if (session) router.replace("/scan");
  }, [session, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!online) {
      setError(
        "Anda sedang offline. Login pertama butuh koneksi internet untuk verifikasi."
      );
      return;
    }
    if (!username.trim() || !password) {
      setError("Isi username dan password.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        user?: string;
        error?: string;
      };
      if (response.ok && data.ok && data.user) {
        setSession({ user: data.user, loginAt: new Date().toISOString() });
        router.replace("/scan");
        return;
      }
      setError(data.error ?? "Login gagal.");
    } catch {
      setError("Tidak dapat menghubungi server. Periksa koneksi internet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rise">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="relative flex size-14 items-center justify-center rounded-2xl border border-accent/30 bg-panel">
            <span className="absolute left-1.5 top-1.5 h-2.5 w-2.5 border-l-2 border-t-2 border-accent" />
            <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 border-r-2 border-t-2 border-accent" />
            <span className="absolute bottom-1.5 left-1.5 h-2.5 w-2.5 border-b-2 border-l-2 border-accent" />
            <span className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 border-b-2 border-r-2 border-accent" />
            <span className="h-1 w-6 rounded-full bg-accent" />
          </div>
          <div>
            <h1 className="font-mono text-xl font-bold tracking-[0.22em] text-foreground">
              PACKSCAN
            </h1>
            <p className="mt-1 text-xs uppercase tracking-[0.3em] text-muted">
              Stasiun Packing
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-panel p-6 shadow-2xl shadow-black/40">
          {!online && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amberish/40 bg-amberish/10 px-3 py-2.5 text-xs leading-relaxed text-amberish">
              <WifiOff className="mt-0.5 size-4 shrink-0" />
              <span>
                Mode offline. Login pertama butuh internet — setelah pernah
                login, aplikasi bisa dibuka tanpa koneksi.
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="username"
                className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="mis. admin"
                className="mt-1.5 h-11 w-full rounded-xl border border-line bg-panel-2 px-3.5 font-mono text-sm tracking-wider text-foreground transition-colors placeholder:text-muted/50 focus:border-accent/60"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                className="mt-1.5 h-11 w-full rounded-xl border border-line bg-panel-2 px-3.5 font-mono text-sm tracking-wider text-foreground transition-colors placeholder:text-muted/50 focus:border-accent/60"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-rec/40 bg-rec/10 px-3 py-2.5 text-xs leading-relaxed text-rec">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-bold text-[#05261a] transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Memverifikasi…
                </>
              ) : (
                <>
                  <LockKeyhole className="size-4" />
                  Masuk
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted">
          Akun demo: <span className="font-mono text-foreground">admin</span> /{" "}
          <span className="font-mono text-foreground">123456</span>
          <br />
          Login sekali secara online, setelah itu bisa dipakai offline.
        </p>

        <noscript>
          <p className="mt-4 rounded-xl border border-rec/40 bg-rec/10 px-3 py-2.5 text-center text-xs text-rec">
            Aplikasi ini membutuhkan JavaScript — aktifkan JavaScript dan
            gunakan browser modern (Chrome terbaru).
          </p>
        </noscript>

        <div
          id="hydration-warning"
          style={{ display: "none" }}
          className="mt-4 rounded-xl border border-amberish/40 bg-amberish/10 px-3 py-2.5 text-xs leading-relaxed text-amberish"
        >
          Aplikasi gagal dimuat di browser ini — kemungkinan versi browser
          terlalu lama atau file JavaScript diblokir. Gunakan Chrome/Edge
          terbaru lalu muat ulang.
        </div>

        <script
          dangerouslySetInnerHTML={{
            __html:
              'window.addEventListener("load",function(){setTimeout(function(){if(!window.__PACKSCAN_HYDRATED){var el=document.getElementById("hydration-warning");if(el)el.style.display="block";}},4000);});',
          }}
        />
      </div>
    </main>
  );
}
