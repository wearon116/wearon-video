const SESSION_KEY = "wearon_supabase_session";

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase 환경 변수가 설정되지 않았습니다.");
  }
  return { url, key };
}

async function request(path, options = {}) {
  const { url, key } = config();
  const headers = {
    apikey: key,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const res = await fetch(`${url}${path}`, {
    ...options,
    headers
  });

  let data = null;
  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    const message =
      data?.msg ||
      data?.message ||
      data?.error_description ||
      data?.error ||
      "요청 처리 중 오류가 발생했습니다.";
    throw new Error(message);
  }

  return data;
}

function saveSession(data) {
  if (typeof window === "undefined" || !data?.access_token) return null;

  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at:
      data.expires_at ||
      Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    token_type: data.token_type || "bearer"
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent("wearon-auth-changed"));
  return session;
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent("wearon-auth-changed"));
}

export function readSession() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

export async function refreshSession(session = readSession()) {
  if (!session?.refresh_token) {
    clearSession();
    return null;
  }

  const data = await request("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });

  return saveSession(data);
}

export async function getSession() {
  let session = readSession();
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || session.expires_at <= now + 60) {
    try {
      session = await refreshSession(session);
    } catch {
      clearSession();
      return null;
    }
  }

  return session;
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session?.access_token) return null;

  try {
    return await request("/auth/v1/user", {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
  } catch {
    clearSession();
    return null;
  }
}

export async function signUp({ email, password, fullName }) {
  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}/` : undefined;

  const suffix = redirectTo
    ? `?redirect_to=${encodeURIComponent(redirectTo)}`
    : "";

  const data = await request(`/auth/v1/signup${suffix}`, {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      data: { full_name: fullName || "" }
    })
  });

  if (data?.access_token) saveSession(data);
  return data;
}

export async function signIn({ email, password }) {
  const data = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });

  saveSession(data);
  return data;
}

export async function signOut() {
  const session = readSession();

  try {
    if (session?.access_token) {
      await request("/auth/v1/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
    }
  } finally {
    clearSession();
  }
}

export async function consumeAuthRedirect() {
  if (typeof window === "undefined" || !window.location.hash) return false;

  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  if (!accessToken) return false;

  saveSession({
    access_token: accessToken,
    refresh_token: params.get("refresh_token"),
    expires_in: Number(params.get("expires_in") || 3600),
    token_type: params.get("token_type") || "bearer"
  });

  window.history.replaceState(
    {},
    document.title,
    window.location.pathname + window.location.search
  );

  return true;
}

export async function authenticatedFetch(path, options = {}) {
  const session = await getSession();
  if (!session?.access_token) {
    throw new Error("로그인이 필요합니다.");
  }

  const { url, key } = config();
  const target = path.startsWith("http") ? path : `${url}${path}`;

  return fetch(target, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {})
    }
  });
}


export async function resendSignupConfirmation(email) {
  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}/` : undefined;

  const suffix = redirectTo
    ? `?redirect_to=${encodeURIComponent(redirectTo)}`
    : "";

  return request(`/auth/v1/resend${suffix}`, {
    method: "POST",
    body: JSON.stringify({
      type: "signup",
      email
    })
  });
}
