import { paidPlan } from "./plans";

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경 변수가 없습니다.`);
  return value;
}

export async function requireUser(request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new Error("로그인이 필요합니다.");

  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  const res = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });

  if (!res.ok) throw new Error("로그인 정보를 확인할 수 없습니다.");
  return res.json();
}

export function planById(id) {
  const plan = paidPlan(id);
  if (!plan) throw new Error("유효하지 않은 요금제입니다.");
  return plan;
}

export async function adminRest(path, options = {}) {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const secret = env("SUPABASE_SECRET_KEY");

  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: secret,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    cache: "no-store"
  });
}

export function tossAuthHeader() {
  const secret = env("TOSS_SECRET_KEY");
  return `Basic ${Buffer.from(`${secret}:`).toString("base64")}`;
}
