import { NextResponse } from "next/server";
import { adminAccessToken, hasAdminAccess } from "../../../../lib/adminServer";
import { timingSafeEqual } from "crypto";

function matchesPassword(input) {
  const expected = process.env.ADMIN_ACCESS_PASSWORD || "";
  if (!expected || typeof input !== "string" || input.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(input), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function GET(request) {
  return NextResponse.json({ unlocked: hasAdminAccess(request) });
}

export async function POST(request) {
  try {
    const { password } = await request.json();
    if (!matchesPassword(password)) {
      return NextResponse.json({ message: "비밀번호가 올바르지 않습니다." }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set("wearon_admin_access", adminAccessToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 12
    });
    return response;
  } catch {
    return NextResponse.json({ message: "관리자 인증에 실패했습니다." }, { status: 400 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("wearon_admin_access", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0
  });
  return response;
}
