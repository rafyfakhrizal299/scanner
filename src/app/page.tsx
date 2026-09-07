import { redirect } from "next/navigation";

export default function GatePage() {
  // Redirect di sisi server: tidak ada layar kosong, dan tetap berfungsi
  // saat dibuka dari device lain. Cek sesi (ke /scan) dilakukan di /login.
  redirect("/login");
}
