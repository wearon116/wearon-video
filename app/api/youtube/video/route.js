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

async function fetchChannelAvatar(channelId, key) {
  if (!channelId || !key) return "";
  try {
    const params = new URLSearchParams({
      part: "snippet",
      id: channelId,
      key
    });
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?${params}`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return "";
    const data = await res.json();
    const thumbnails = data.items?.[0]?.snippet?.thumbnails || {};
    return String(
      thumbnails.high?.url ||
      thumbnails.medium?.url ||
      thumbnails.default?.url ||
      ""
    );
  } catch {
    return "";
  }
}

async function fetchTopComments(videoId, key) {
  if (!key) return [];
  try {
    const params = new URLSearchParams({
      part: "snippet",
      videoId,
      maxResults: "20",
      order: "relevance",
      textFormat: "plainText",
      key
    });
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/commentThreads?${params}`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || [])
      .map((item) => {
        const s = item?.snippet?.topLevelComment?.snippet || {};
        return {
          id: String(item?.snippet?.topLevelComment?.id || item?.id || ""),
          author: String(s.authorDisplayName || "").slice(0, 80),
          avatar: String(s.authorProfileImageUrl || ""),
          text: String(s.textOriginal || s.textDisplay || "").replace(/\s+/g, " ").trim().slice(0, 220),
          likeCount: Number(s.likeCount || 0),
          publishedAt: s.publishedAt || ""
        };
      })
      .filter((comment) => comment.text)
      .slice(0, 20);
  } catch {
    return [];
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

    const [res, comments] = await Promise.all([
      fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
        next: { revalidate: 300 }
      }),
      fetchTopComments(id, key)
    ]);

    if (res.ok) {
      const data = await res.json();
      const v = data.items?.[0];
      if (v) {
        const channelAvatar = await fetchChannelAvatar(v.snippet?.channelId || "", key);
        return Response.json({
          id,
          url: rawUrl,
          title: v.snippet?.title || "",
          channelTitle: v.snippet?.channelTitle || "",
          channelAvatar,
          description: v.snippet?.description || "",
          tags: Array.isArray(v.snippet?.tags) ? v.snippet.tags.slice(0, 12) : [],
          thumbnail:
            v.snippet?.thumbnails?.maxres?.url ||
            v.snippet?.thumbnails?.high?.url ||
            v.snippet?.thumbnails?.medium?.url ||
            `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
          viewCount: Number(v.statistics?.viewCount || 0),
          commentCount: Number(v.statistics?.commentCount || 0),
          duration: v.contentDetails?.duration || "",
          comments
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
      id,
      url: rawUrl,
      title: "YouTube 영상",
      channelTitle: "",
      channelAvatar: "",
      thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
      comments: []
    });
  }

  const data = await oembed.json();
  return Response.json({
    id,
    url: rawUrl,
    title: data.title || "YouTube 영상",
    channelTitle: data.author_name || "",
    channelAvatar: "",
    description: "",
    tags: [],
    thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    comments: []
  });
}
