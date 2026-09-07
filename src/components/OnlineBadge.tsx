"use client";

import { useSyncExternalStore } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { subscribeOnline } from "@/lib/online";

function getOnline() {
  return navigator.onLine;
}

function getServerOnline() {
  return true;
}

export default function OnlineBadge() {
  const online = useSyncExternalStore(subscribeOnline, getOnline, getServerOnline);

  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wide ${
        online
          ? "border-accent/30 bg-accent/10 text-accent"
          : "border-amberish/40 bg-amberish/10 text-amberish"
      }`}
    >
      {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
      {online ? "Online" : "Offline"}
    </div>
  );
}
