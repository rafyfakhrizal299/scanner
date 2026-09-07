"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { History, LogOut, Package, ScanLine } from "lucide-react";
import OnlineBadge from "@/components/OnlineBadge";
import { clearSession } from "@/lib/session";

const NAV = [
  { href: "/scan", label: "Scan", icon: ScanLine },
  { href: "/riwayat", label: "Riwayat", icon: History },
];

export default function AppHeader({ user }: { user: string }) {
  const router = useRouter();
  const pathname = usePathname();

  function handleLogout() {
    clearSession();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-background/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3.5 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg border border-accent/30 bg-panel">
            <Package className="size-4.5 text-accent" />
          </div>
          <div className="leading-tight">
            <p className="font-mono text-sm font-bold tracking-[0.22em] text-foreground">
              PACKSCAN
            </p>
            <p className="hidden text-[10px] uppercase tracking-[0.3em] text-muted sm:block">
              Stasiun Packing
            </p>
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-full border border-line bg-panel p-1">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-accent/15 text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5">
          <OnlineBadge />
          <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-2 py-1.5">
            <span className="flex size-5 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] font-bold text-accent">
              {user.slice(0, 1).toUpperCase()}
            </span>
            <span className="pr-1 text-xs font-semibold text-foreground">{user}</span>
          </div>
          <button
            onClick={handleLogout}
            title="Keluar"
            className="rounded-full border border-line bg-panel p-2 text-muted transition-colors hover:border-rec/50 hover:text-rec"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
