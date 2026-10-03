export const dynamic = "force-dynamic";

function extractId(raw) {
  try {
    const u = new URL(raw);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0];
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2];
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url") || "";
  const id = extractId(rawUrl);
  if (!id) return Response.json({ error: "INVALID_YOUTUBE_URL" }, { status: 400 });

  const key = process.env.YOUTUBE_API_KEY;

  if (key) {
    const params = new URLSearchParams({
      part: "snippet,statistics,contentDetails",
      id,
      key
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
      next: { revalidate: 300 }
    });
    if (res.ok) {
      const data = await res.json();
      const v = data.items?.[0];
      if (v) {
        return Response.json({
          id,
          url: rawUrl,
          title: v.snippet?.title || "",
          channelTitle: v.snippet?.channelTitle || "",
          description: v.snippet?.description || "",
          tags: Array.isArray(v.snippet?.tags) ? v.snippet.tags.slice(0, 12) : [],
          thumbnail:
            v.snippet?.thumbnails?.maxres?.url ||
            v.snippet?.thumbnails?.high?.url ||
            v.snippet?.thumbnails?.medium?.url ||
            `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
          viewCount: Number(v.statistics?.viewCount || 0),
          duration: v.contentDetails?.duration || ""
        });
      }
    }
  }

  // API key가 없어도 공개 oEmbed 정보로 제목/채널/썸네일은 조회 가능
  const oembed = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(rawUrl)}&format=json`,
    { cache: "no-store" }
  );

  if (!oembed.ok) {
    return Response.json({
      id, url: rawUrl, title: "YouTube 영상", channelTitle: "",
      thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg`
    });
  }

  const data = await oembed.json();
  return Response.json({
    id,
    url: rawUrl,
    title: data.title || "YouTube 영상",
    channelTitle: data.author_name || "",
    description: "",
    tags: [],
    thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${id}/hqdefault.jpg`
  });
}
