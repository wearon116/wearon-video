import { createHash, timingSafeEqual } from "crypto";
import { adminRest, requireUser } from "./paymentServer";

function serverEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경 변수가 없습니다.`);
  return value;
}

function adminPassword() {
  const value = process.env.ADMIN_ACCESS_PASSWORD;
  if (!value) throw new Error("관리자 비밀번호 환경 변수가 없습니다.");
  return value;
}

export function adminAccessToken() {
  return createHash("sha256")
    .update(`wearon-admin-access:${adminPassword()}`)
    .digest("hex");
}

export function hasAdminAccess(request) {
  const actual = request.cookies?.get?.("wearon_admin_access")?.value || "";
  const expected = adminAccessToken();
  if (!actual || actual.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function requireAdmin(request) {
  if (!hasAdminAccess(request)) {
    const error = new Error("관리자 비밀번호 인증이 필요합니다.");
    error.status = 401;
    throw error;
  }

  const user = await requireUser(request);
  const res = await adminRest(
    `admin_users?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`
  );

  if (!res.ok) throw new Error("관리자 권한 확인에 실패했습니다.");
  const rows = await res.json();
  if (!rows?.length) {
    const error = new Error("관리자 권한이 없습니다.");
    error.status = 403;
    throw error;
  }

  return user;
}

export async function adminAuthUsers() {
  const url = serverEnv("NEXT_PUBLIC_SUPABASE_URL");
  const secret = serverEnv("SUPABASE_SECRET_KEY");

  const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: secret },
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error("회원 목록을 불러오지 못했습니다.");
  }

  const data = await res.json();
  return Array.isArray(data) ? data : (data?.users || []);
}
