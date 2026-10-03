import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/paymentServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OPUS_BASE = "https://api.opus.pro/api";
const MAX_CLIPS = 6;

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경 변수가 없습니다.`);
  return String(value).trim();
}

function normalizeApiKey(value) {
  let key = String(value || "").trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/^Authorization:\s*/i, "").trim();
  key = key.replace(/^Bearer\s+/i, "").trim();
  return key;
}

function signAccess(userId, projectId) {
  return createHmac("sha256", env("SUPABASE_SECRET_KEY"))
    .update(`wearon-opusclip:${userId}:${projectId}`)
    .digest("hex");
}

function validAccess(userId, projectId, token) {
  const expected = signAccess(userId, projectId);
  const actual = String(token || "");
  if (!actual || actual.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  } catch {
    return false;
  }
}

function opusHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function extractProjectId(raw) {
  const data = raw?.data ?? raw;
  return String(
    data?.id ||
    data?.projectId ||
    data?.project_id ||
    data?.clipProjectId ||
    ""
  );
}

function unwrapClips(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.data?.list)) return raw.data.list;
  if (Array.isArray(raw?.list)) return raw.list;
  return [];
}

function clipSuffix(id, projectId) {
  const raw = String(id || "");
  if (projectId && raw.startsWith(projectId + ".")) {
    return raw.slice(projectId.length + 1);
  }
  const dot = raw.indexOf(".");
  return dot >= 0 ? raw.slice(dot + 1) : raw;
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeClip(raw, projectId, index) {
  const judge = raw?.judgeResult || {};
  const duration = Math.max(
    1,
    Math.round(
      safeNumber(raw?.durationMs, 0) / 1000 ||
      safeNumber(raw?.durationSec, 0) ||
      safeNumber(raw?.duration, 0) ||
      45
    )
  );

  return {
    clipId: String(raw?.curationId || clipSuffix(raw?.id, projectId) || index + 1),
    title: String(raw?.title || `핵심 장면 #${index + 1}`).slice(0, 140),
    description: String(raw?.description || "").slice(0, 800),
    transcript: String(raw?.text || raw?.transcript || "").slice(0, 10000),
    duration,
    score: Math.max(
      0,
      Math.min(
        100,
        Math.round(
          safeNumber(raw?.score, 0) ||
          safeNumber(judge?.overallScore, 0) ||
          90 - index * 3
        )
      )
    ),
    rank: safeNumber(raw?.rank, index + 1),
    previewUrl: typeof raw?.uriForPreview === "string" ? raw.uriForPreview : "",
    exportUrl: typeof raw?.uriForExport === "string" ? raw.uriForExport : "",
    thumbnailUrl: typeof raw?.uriForThumbnail === "string" ? raw.uriForThumbnail : "",
    renderPending:
      raw?.renderAsVideoPreview?.pending === true ||
      raw?.renderAsVideoFile?.pending === true
  };
}

function topClips(raw, projectId) {
  return unwrapClips(raw)
    .map((clip, index) => normalizeClip(clip, projectId, index))
    .filter((clip) => clip.previewUrl || clip.exportUrl)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.rank - b.rank;
    })
    .slice(0, MAX_CLIPS);
}

async function opusFetch(path, apiKey, init = {}) {
  const res = await fetch(`${OPUS_BASE}${path}`, {
    ...init,
    headers: {
      ...opusHeaders(apiKey),
      ...(init.headers || {})
    },
    cache: "no-store"
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  return { res, data };
}

function providerMessage(data) {
  if (!data) return "";
  if (typeof data === "string") return data.slice(0, 600);
  const direct =
    data?.error?.message ||
    data?.error ||
    data?.message ||
    data?.detail ||
    data?.reason ||
    data?.data?.message ||
    "";
  if (direct) return String(direct).slice(0, 600);
  try {
    return JSON.stringify(data).slice(0, 600);
  } catch {
    return "";
  }
}

function friendlyOpusError(status, data) {
  const detail = providerMessage(data);
  if (status === 401) {
    return "OpusClip API 키 인증에 실패했습니다. Vercel의 OPUSCLIP_API_KEY를 확인해주세요.";
  }
  if (status === 403) {
    return "OpusClip API 사용 권한이 없습니다. OpusClip에서 API 사용이 가능한 요금제/권한을 확인해주세요.";
  }
  if (status === 429) {
    return "OpusClip API 사용량 또는 동시 작업 한도에 도달했습니다. 잠시 후 다시 시도하거나 API 사용량을 확인해주세요.";
  }
  return `OpusClip 오류 (HTTP ${status})${detail ? `: ${detail}` : ""}`;
}

async function projectStage(projectId, apiKey) {
  try {
    const { res, data } = await opusFetch("/clip-projects?page=0&pageSize=50", apiKey);
    if (!res.ok) return "";
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data?.list)
        ? data.list
        : Array.isArray(data?.data)
          ? data.data
          : [];
    const found = rows.find((item) => String(item?.projectId || item?.id || "") === projectId);
    return String(found?.stage || found?.status || "").toLowerCase();
  } catch {
    return "";
  }
}

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();

    const youtubeUrl = String(body?.youtubeUrl || "").trim();
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(youtubeUrl)) {
      return NextResponse.json(
        { message: "유효한 YouTube 링크를 입력해주세요." },
        { status: 400 }
      );
    }

    const apiKey = normalizeApiKey(env("OPUSCLIP_API_KEY"));
    if (!apiKey) throw new Error("OPUSCLIP_API_KEY 환경 변수가 없습니다.");

    const ratio = String(body?.aspectRatio || "9:16");
    const layoutAspectRatio =
      ratio === "16:9" ? "landscape" :
      ratio === "1:1" ? "square" :
      ratio === "4:5" ? "four_five" :
      "portrait";

    const payload = {
      videoUrl: youtubeUrl,
      curationPref: {
        clipDurations: [[20, 45]],
        customPrompt:
          "Pick the funniest, most surprising, highest-reaction moments that work as standalone shorts. Prefer clear setup/payoff and replayable reactions. Skip intros, ads, dead air, and repetitive filler."
      },
      renderPref: {
        layoutAspectRatio,
        enableCaption: true,
        quickstartConfig: {
          enableRemoveFillerWords: false
        }
      }
    };

    const { res, data } = await opusFetch("/clip-projects", apiKey, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      return NextResponse.json(
        { message: friendlyOpusError(res.status, data) },
        { status: res.status >= 400 && res.status < 500 ? res.status : 500 }
      );
    }

    const projectId = extractProjectId(data);
    if (!projectId) {
      return NextResponse.json(
        { message: `OpusClip 프로젝트 ID를 받지 못했습니다. 응답: ${providerMessage(data) || "unknown"}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      jobId: projectId,
      projectId,
      accessToken: signAccess(user.id, projectId),
      status: "processing",
      progress: 10,
      clipCount: 0,
      provider: "opusclip",
      model: "auto",
      mode: "youtube_autoclip"
    });
  } catch (error) {
    const message = String(error?.message || "YouTube 자동 쇼츠 생성 중 오류가 발생했습니다.");
    const friendly = message.includes("OPUSCLIP_API_KEY")
      ? "OpusClip API 키가 아직 연결되지 않았습니다. Vercel에 OPUSCLIP_API_KEY를 추가해주세요."
      : message;

    return NextResponse.json({ message: friendly }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);

    const projectId = String(searchParams.get("jobId") || searchParams.get("projectId") || "");
    const accessToken = String(searchParams.get("token") || "");
    const action = String(searchParams.get("action") || "status");
    const index = Math.max(0, Number(searchParams.get("index") || 0));

    if (!projectId || !validAccess(user.id, projectId, accessToken)) {
      return NextResponse.json(
        { message: "쇼츠 작업 접근 권한을 확인할 수 없습니다." },
        { status: 403 }
      );
    }

    const apiKey = normalizeApiKey(env("OPUSCLIP_API_KEY"));
    const query = `/exportable-clips?q=findByProjectId&projectId=${encodeURIComponent(projectId)}`;
    const { res, data } = await opusFetch(query, apiKey);

    if (!res.ok) {
      return NextResponse.json(
        { message: friendlyOpusError(res.status, data) },
        { status: res.status >= 400 && res.status < 500 ? res.status : 500 }
      );
    }

    const clips = topClips(data, projectId);

    if (action === "content") {
      const target = clips[index];
      if (!target) {
        return NextResponse.json(
          { message: `완성된 쇼츠 #${index + 1}을 아직 찾지 못했습니다.` },
          { status: 404 }
        );
      }

      const mediaUrl = target.exportUrl || target.previewUrl;
      if (!mediaUrl) {
        return NextResponse.json(
          { message: "완성된 쇼츠 영상 주소를 찾지 못했습니다." },
          { status: 404 }
        );
      }

      const mediaRes = await fetch(mediaUrl, { cache: "no-store" });
      if (!mediaRes.ok || !mediaRes.body) {
        return NextResponse.json(
          { message: "OpusClip 쇼츠 영상을 불러오지 못했습니다." },
          { status: mediaRes.status || 502 }
        );
      }

      return new Response(mediaRes.body, {
        headers: {
          "Content-Type": mediaRes.headers.get("content-type") || "video/mp4",
          "Content-Disposition": `inline; filename="WEARON_CLIP_${index + 1}.mp4"`,
          "Cache-Control": "private, no-store"
        }
      });
    }

    if (clips.length > 0 && clips.every((clip) => Boolean(clip.previewUrl || clip.exportUrl))) {
      return NextResponse.json({
        id: projectId,
        status: "completed",
        progress: 100,
        clipCount: clips.length,
        clips: clips.map((clip) => ({
          clipId: clip.clipId,
          title: clip.title,
          description: clip.description,
          transcript: clip.transcript,
          duration: clip.duration,
          score: clip.score,
          start: 0,
          thumbnailUrl: clip.thumbnailUrl,
          renderPending: clip.renderPending
        })),
        error: null,
        provider: "opusclip",
        model: "auto"
      });
    }

    const stage = await projectStage(projectId, apiKey);
    const failed =
      stage.includes("fail") ||
      stage.includes("error") ||
      stage.includes("cancel");

    return NextResponse.json({
      id: projectId,
      status: failed ? "failed" : "processing",
      progress: failed ? 0 : stage ? 55 : 30,
      clipCount: 0,
      clips: [],
      error: failed
        ? { message: `OpusClip 프로젝트 처리에 실패했습니다. 상태: ${stage || "failed"}` }
        : null,
      provider: "opusclip",
      model: "ClipAnything",
      stage
    });
  } catch (error) {
    const message = String(error?.message || "쇼츠 작업 상태 확인 중 오류가 발생했습니다.");
    const friendly = message.includes("OPUSCLIP_API_KEY")
      ? "OpusClip API 키가 아직 연결되지 않았습니다. Vercel에 OPUSCLIP_API_KEY를 추가해주세요."
      : message;

    return NextResponse.json({ message: friendly }, { status: 500 });
  }
}
