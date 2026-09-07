export function slugResi(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

export function fmtDuration(totalSeconds: number): string {
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((totalSeconds / 60) % 60)
    .toString()
    .padStart(2, "0");
  const h = Math.floor(totalSeconds / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function stampDate(date = new Date()): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

export function fmtClock(iso: string | number): string {
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
