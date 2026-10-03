import { NextResponse } from "next/server";

export async function GET() {
  const key = process.env.SUPABASE_SECRET_KEY || "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

  const keyType = key.startsWith("sb_secret_")
    ? "sb_secret"
    : key.startsWith("sb_publishable_")
      ? "sb_publishable"
      : key.startsWith("eyJ")
        ? "legacy_jwt"
        : key
          ? "unknown"
          : "missing";

  let restStatus = null;
  let restMessage = null;

  if (key && url) {
    try {
      const res = await fetch(`${url}/rest/v1/payment_orders?select=id&limit=1`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`
        },
        cache: "no-store"
      });
      restStatus = res.status;
      if (!res.ok) {
        const text = await res.text();
        try {
          const parsed = JSON.parse(text);
          restMessage = parsed?.message || parsed?.hint || text.slice(0, 180);
        } catch {
          restMessage = text.slice(0, 180);
        }
      } else {
        restMessage = "ok";
      }
    } catch (error) {
      restMessage = error?.message || "request failed";
    }
  }

  return NextResponse.json({
    keyType,
    keyPresent: Boolean(key),
    supabaseUrlPresent: Boolean(url),
    restStatus,
    restMessage
  });
}
