import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Izinkan akses dev server dari perangkat lain di jaringan lokal.
  // Tanpa ini, Next memblokir CSS/JS chunks yang di-request dari origin lain.
  allowedDevOrigins: ["192.168.1.110"],
};

export default nextConfig;
