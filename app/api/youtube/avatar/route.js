export const dynamic = "force-dynamic";

function allowedAvatarUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    const allowed =
      host === "yt3.ggpht.com" ||
      host.endsWith(".googleusercontent.com") ||
      host === "lh3.googleusercontent.com";
    return allowed ? url : null;
  } catch {
    return null;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = allowedAvatarUrl(searchParams.get("url") || "");
  if (!url) return new Response("INVALID_AVATAR_URL", { status: 400 });

  try {
    const res = await fetch(url, {
      cache: "force-cache",
      headers: { "User-Agent": "WEARON-VIDEO/1.0" }
    });
    if (!res.ok) return new Response("AVATAR_FETCH_FAILED", { status: 502 });

    const type = res.headers.get("content-type") || "image/jpeg";
    const body = await res.arrayBuffer();
    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=86400, s-maxage=86400"
      }
    });
  } catch {
    return new Response("AVATAR_FETCH_FAILED", { status: 502 });
  }
}
