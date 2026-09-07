import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PackScan — Stasiun Packing",
    short_name: "PackScan",
    description:
      "Scan resi & rekam video proses packing langsung dari perangkat. Bekerja online maupun offline.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "landscape",
    background_color: "#07090d",
    theme_color: "#07090d",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
