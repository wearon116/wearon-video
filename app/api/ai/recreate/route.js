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

function friendlyOpusError(status, data, context = {}) {
  const detail = providerMessage(data);
  const sourceDurationSec = Math.max(0, Number(context?.sourceDurationSec || 0));
  const requestedRangeSec = Math.max(0, Number(context?.requestedRangeSec || 0));
  const billedSec = requestedRangeSec > 0
    ? Math.min(sourceDurationSec || requestedRangeSec, requestedRangeSec)
    : sourceDurationSec;
  const estimatedCredits = billedSec > 0 ? Math.max(1, Math.ceil(billedSec / 60)) : 0;

  if (status === 402) {
    const estimate = estimatedCredits
      ? ` 이 설정은 약 ${estimatedCredits}크레딧(약 ${Math.ceil(billedSec / 60)}분 분석)이 필요합니다.`
      : "";
    return `OpusClip 크레딧이 부족합니다.${estimate} OpusClip에서 크레딧을 추가하거나, WEARON VIDEO에서 분석 범위를 30분/60분으로 줄여 다시 시도해주세요.`;
  }
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

function stageUi(stage) {
  const value = String(stage || "").toLowerCase();

  if (
    value.includes("queue") ||
    value.includes("pending") ||
    value.includes("upload") ||
    value.includes("download") ||
    value.includes("ingest")
  ) {
    return {
      phase: "source",
      progress: 22,
      message: "YouTube 원본 영상을 불러오는 중..."
    };
  }

  if (
    value.includes("transcrib") ||
    value.includes("curat") ||
    value.includes("analy") ||
    value.includes("detect") ||
    value.includes("clip")
  ) {
    return {
      phase: "analyze",
      progress: 48,
      message: "AI가 전체 영상에서 핵심 장면을 분석하는 중..."
    };
  }

  if (
    value.includes("render") ||
    value.includes("caption") ||
    value.includes("export") ||
    value.includes("preview")
  ) {
    return {
      phase: "render",
      progress: 78,
      message: "선택한 장면을 9:16 쇼츠와 자막으로 렌더링하는 중..."
    };
  }

  if (
    value.includes("complete") ||
    value.includes("finish") ||
    value.includes("done") ||
    value.includes("success")
  ) {
    return {
      phase: "finalize",
      progress: 92,
      message: "완성된 쇼츠 파일을 정리하는 중..."
    };
  }

  return {
    phase: "analyze",
    progress: 32,
    message: "OpusClip AI가 영상을 분석하고 있습니다..."
  };
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
    const sourceDurationSec = Math.max(0, Number(body?.sourceDurationSec || 0));
    const maxAnalysisSeconds = Math.max(0, Number(body?.maxAnalysisSeconds || 0));
    const requestedRangeSec = maxAnalysisSeconds > 0
      ? (sourceDurationSec > 0 ? Math.min(sourceDurationSec, maxAnalysisSeconds) : maxAnalysisSeconds)
      : sourceDurationSec;

    // WEARON 최종 저장본은 9:16 캔버스 안에 16:9 원본 영상을 배치합니다.
    // OpusClip 단계에서는 원본 프레임을 최대한 보존하기 위해 항상 landscape로 받아옵니다.
    const layoutAspectRatio = "landscape";

    const payload = {
      videoUrl: youtubeUrl,
      curationPref: {
        ...(maxAnalysisSeconds > 0 ? { range: { startSec: 0, endSec: maxAnalysisSeconds } } : {}),
        clipDurations: [[20, 45]],
        customPrompt:
          "Select exactly the 6 strongest standalone moments for short-form viewing. Rank by hook strength, clear setup/payoff, surprise, humor, emotion, useful insight, and replay value. Skip intros, ads, dead air, sponsor reads, and repetitive filler. Keep the original spoken content intact and do not add generated captions."
      },
      renderPref: {
        layoutAspectRatio,
        enableCaption: false,
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
        {
          message: friendlyOpusError(res.status, data, { sourceDurationSec, requestedRangeSec }),
          code: res.status === 402 ? "INSUFFICIENT_OPUS_CREDITS" : undefined,
          estimatedCredits: requestedRangeSec > 0 ? Math.max(1, Math.ceil(requestedRangeSec / 60)) : 0
        },
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
    const clipId = String(searchParams.get("clipId") || "");

    if (!projectId || !validAccess(user.id, projectId, accessToken)) {
      return NextResponse.json(
        { message: "쇼츠 작업 접근 권한을 확인할 수 없습니다." },
        { status: 403 }
      );
    }

    const apiKey = normalizeApiKey(env("OPUSCLIP_API_KEY"));
    const query = `/exportable-clips?q=findByProjectId&projectId=${encodeURIComponent(projectId)}`;

    // 상태와 결과 조회를 동시에 실행해서 매 폴링 요청의 대기 시간을 줄입니다.
    // OpusClip의 분석/렌더링 설정은 그대로 유지하므로 결과 퀄리티에는 영향을 주지 않습니다.
    const [clipResult, stage] = await Promise.all([
      opusFetch(query, apiKey),
      action === "content" ? Promise.resolve("") : projectStage(projectId, apiKey)
    ]);
    const { res, data } = clipResult;

    if (!res.ok) {
      return NextResponse.json(
        { message: friendlyOpusError(res.status, data) },
        { status: res.status >= 400 && res.status < 500 ? res.status : 500 }
      );
    }

    const clips = topClips(data, projectId);
    const readyClips = clips.filter((clip) => Boolean(clip.previewUrl || clip.exportUrl));

    if (action === "content") {
      const target = clipId
        ? readyClips.find((clip) => String(clip.clipId || "") === clipId)
        : readyClips[index];

      if (!target) {
        return NextResponse.json(
          { message: clipId ? "해당 쇼츠 파일이 아직 준비되지 않았습니다." : `완성된 쇼츠 #${index + 1}을 아직 찾지 못했습니다.` },
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

    const failed =
      stage.includes("fail") ||
      stage.includes("error") ||
      stage.includes("cancel");
    const stageComplete =
      stage.includes("complete") ||
      stage.includes("finish") ||
      stage.includes("done") ||
      stage.includes("success");
    const topSixReady =
      clips.length >= MAX_CLIPS &&
      clips.slice(0, MAX_CLIPS).every((clip) => Boolean(clip.previewUrl || clip.exportUrl));
    const completed = !failed && readyClips.length > 0 && (stageComplete || topSixReady);

    if (completed) {
      const finalClips = clips
        .filter((clip) => Boolean(clip.previewUrl || clip.exportUrl))
        .slice(0, MAX_CLIPS);

      return NextResponse.json({
        id: projectId,
        status: "completed",
        progress: 100,
        phase: "ready",
        message: "쇼츠 생성이 완료됐습니다.",
        stage,
        clipCount: finalClips.length,
        readyClipCount: finalClips.length,
        clips: finalClips.map((clip) => ({
          clipId: clip.clipId,
          title: clip.title,
          description: clip.description,
          transcript: clip.transcript,
          duration: clip.duration,
          score: clip.score,
          start: 0,
          thumbnailUrl: clip.thumbnailUrl,
          previewUrl: clip.previewUrl,
          exportUrl: clip.exportUrl,
          renderPending: clip.renderPending
        })),
        error: null,
        provider: "opusclip",
        model: "auto"
      });
    }

    const ui = stageUi(stage);

    return NextResponse.json({
      id: projectId,
      status: failed ? "failed" : "processing",
      progress: failed ? 0 : Math.max(ui.progress, readyClips.length ? 82 : 0),
      phase: failed ? "failed" : ui.phase,
      message: failed
        ? "OpusClip 처리 중 오류가 발생했습니다."
        : readyClips.length
          ? `핵심 쇼츠 ${readyClips.length}/${MAX_CLIPS}개 준비됨 · 나머지 결과를 마무리하는 중...`
          : ui.message,
      clipCount: readyClips.length,
      readyClipCount: readyClips.length,
      clips: readyClips.slice(0, MAX_CLIPS).map((clip) => ({
        clipId: clip.clipId,
        title: clip.title,
        description: clip.description,
        transcript: clip.transcript,
        duration: clip.duration,
        score: clip.score,
        start: 0,
        thumbnailUrl: clip.thumbnailUrl,
        previewUrl: clip.previewUrl,
        exportUrl: clip.exportUrl,
        renderPending: clip.renderPending
      })),
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
