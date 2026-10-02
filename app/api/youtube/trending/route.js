export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get("region") || "KR").toUpperCase();
  const maxResults = Math.min(Number(searchParams.get("maxResults") || 16), 24);
  const key = process.env.YOUTUBE_API_KEY;

  if (!key) {
    return Response.json(
      { error: "YOUTUBE_API_KEY_MISSING", message: "YouTube API 키가 아직 연결되지 않았습니다." },
      { status: 503 }
    );
  }

  const params = new URLSearchParams({
    part: "snippet,statistics,contentDetails",
    chart: "mostPopular",
    regionCode: region,
    maxResults: String(maxResults),
    key
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
    next: { revalidate: 300 }
  });

  if (!res.ok) {
    const body = await res.text();
    return Response.json({ error: "YOUTUBE_API_ERROR", detail: body }, { status: res.status });
  }

  const data = await res.json();
  const items = (data.items || []).map((v, idx) => ({
    rank: idx + 1,
    id: v.id,
    title: v.snippet?.title || "",
    channelTitle: v.snippet?.channelTitle || "",
    thumbnail:
      v.snippet?.thumbnails?.maxres?.url ||
      v.snippet?.thumbnails?.high?.url ||
      v.snippet?.thumbnails?.medium?.url || "",
    publishedAt: v.snippet?.publishedAt || "",
    viewCount: Number(v.statistics?.viewCount || 0),
    likeCount: Number(v.statistics?.likeCount || 0),
    duration: v.contentDetails?.duration || "",
    url: `https://www.youtube.com/watch?v=${v.id}`
  }));

  return Response.json({ region, updatedAt: new Date().toISOString(), items });
}
