import { adminRest, requireUser } from "./paymentServer";

function serverEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경 변수가 없습니다.`);
  return value;
}

export async function requireAdmin(request) {
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
