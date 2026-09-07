import { NextResponse } from "next/server";

const DEMO_USERS: Record<string, string> = {
  admin: "123456",
};

export async function POST(request: Request) {
  let username = "";
  let password = "";

  try {
    const body = (await request.json()) as { username?: string; password?: string };
    username = (body.username ?? "").trim();
    password = body.password ?? "";
  } catch {
    return NextResponse.json(
      { ok: false, error: "Permintaan tidak valid." },
      { status: 400 }
    );
  }

  // Simulasi verifikasi server.
  await new Promise((resolve) => setTimeout(resolve, 450));

  if (DEMO_USERS[username] && DEMO_USERS[username] === password) {
    return NextResponse.json({ ok: true, user: username });
  }

  return NextResponse.json(
    { ok: false, error: "Username atau password salah." },
    { status: 401 }
  );
}
