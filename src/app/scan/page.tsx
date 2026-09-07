"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import Recorder from "@/components/Recorder";
import { getSession, subscribeSession } from "@/lib/session";

function getHydrated() {
  return true;
}

function getServerHydrated() {
  return false;
}

export default function ScanPage() {
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribeSession,
    getHydrated,
    getServerHydrated
  );
  const session = useSyncExternalStore(subscribeSession, getSession, () => null);

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

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AppHeader user={session.user} />
      <main className="flex min-h-0 flex-1 flex-col">
        <Recorder />
      </main>
    </div>
  );
}
