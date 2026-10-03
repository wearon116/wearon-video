import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/paymentServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HF_MODEL = "clipify";
const HF_SUBMIT_URL = "https://api.higgsfield.ai/clipify";
const CLIP_COUNT = 6;

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경 변수가 없습니다.`);
  return String(value).trim();
}

function normalizeHfKey(value) {
  let key = String(value || "").trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/^Authorization:\s*/i, "").trim();
  key = key.replace(/^Key\s+/i, "").trim();
  return key;
}

async function verifyHiggsfieldCredential(hfKey) {
  const probeId = "wearon-credential-check-does-not-exist";
  const res = await fetch(
    `https://api.higgsfield.ai/requests/${probeId}/status`,
    {
      headers: { Authorization: `Key ${hfKey}` },
      cache: "no-store"
    }
  );

  if (res.status === 401 || res.status === 403) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      `HIGGSFIELD_AUTH:${data?.detail || data?.message || "Invalid credentials"}`
    );
  }
}

function signAccess(userId, jobId) {
  return createHmac("sha256", env("SUPABASE_SECRET_KEY"))
    .update(`wearon-clipify:${userId}:${jobId}`)
    .digest("hex");
}

function validAccess(userId, jobId, token) {
  const expected = signAccess(userId, jobId);
  const actual = String(token || "");
  if (!actual || actual.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  } catch {
    return false;
  }
}

function normalizeAspectRatio(value) {
  return ["9:16", "16:9", "1:1"].includes(value) ? value : "9:16";
}

function normalizeStatus(value) {
  const raw = String(value || "queued").toLowerCase();
  if (["completed", "succeeded", "success", "done"].includes(raw)) return "completed";
  if (["failed", "error", "nsfw", "canceled", "cancelled"].includes(raw)) return "failed";
  if (["processing", "running", "in_progress", "in-progress", "working"].includes(raw)) return "processing";
  return "queued";
}

function jobIdFrom(data) {
  return String(
    data?.request_id ||
    data?.requestId ||
    data?.job_id ||
    data?.jobId ||
    data?.id ||
    data?.request?.id ||
    data?.data?.request_id ||
    data?.data?.id ||
    ""
  );
}

function providerMessage(data) {
  if (!data) return "";
  if (typeof data === "string") return data.slice(0, 500);
  const direct =
    (typeof data?.error === "string" ? data.error : "") ||
    data?.error?.message ||
    data?.detail ||
    data?.message ||
    data?.reason ||
    data?.fail_reason ||
    data?.failure_reason ||
    "";
  if (direct) return String(direct).slice(0, 500);
  try {
    return JSON.stringify(data).slice(0, 500);
  } catch {
    return "";
  }
}

function extractClipEntries(data) {
  const found = [];
  const seen = new Set();

  const add = (url, meta = {}) => {
    const value = String(url || "").trim();
    if (!/^https?:\/\//i.test(value)) return;
    if (/\/requests\/.*\/(status|cancel)/i.test(value)) return;
    if (seen.has(value)) return;

    const lower = value.toLowerCase();
    const looksVideo =
      /\.(mp4|mov|webm)(\?|$)/i.test(value) ||
      lower.includes("video") ||
      lower.includes("cloudfront") ||
      lower.includes("cdn");

    if (!looksVideo) return;

    seen.add(value);
    found.push({
      url: value,
      duration: Number(meta?.duration || meta?.duration_seconds || meta?.seconds || meta?.durationSec || 0) || 0,
      start: Number(meta?.start || meta?.start_seconds || meta?.startTime || 0) || 0,
      end: Number(meta?.end || meta?.end_seconds || meta?.endTime || 0) || 0,
      title: String(meta?.title || meta?.hook || meta?.name || meta?.caption || "").slice(0, 120),
      score: Number(meta?.score || meta?.viral_score || meta?.virality_score || 0) || 0,
      transcript: String(meta?.transcript || meta?.text || meta?.subtitle || "").slice(0, 5000)
    });
  };

  const walk = (node, path = "") => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      const nextPath = path ? `${path}.${key}` : key;
      const lowerPath = nextPath.toLowerCase();

      if (typeof value === "string" && /^https?:\/\//i.test(value)) {
        const blocked = /(thumbnail|poster|image|cover|avatar|status_url|cancel_url|upload_url)/.test(lowerPath);
        const mediaish = /(video|clip|output|result|url)/.test(lowerPath);
        if (mediaish && !blocked) add(value, node);
      } else {
        walk(value, nextPath);
      }
    }
  };

  walk(data);
  return found.slice(0, 20);
}

async function hfStatus(jobId, hfKey) {
  const res = await fetch(
    `https://api.higgsfield.ai/requests/${encodeURIComponent(jobId)}/status`,
    {
      headers: { Authorization: `Key ${hfKey}` },
      cache: "no-store"
    }
  );
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();

    const youtubeUrl = String(body?.youtubeUrl || "").trim();
    const aspectRatio = normalizeAspectRatio(String(body?.aspectRatio || "9:16"));
    const brandColor = /^#[0-9a-f]{6}$/i.test(String(body?.brandColor || ""))
      ? String(body.brandColor)
      : "#39D7E6";

    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(youtubeUrl)) {
      return NextResponse.json({ message: "유효한 YouTube 링크를 입력해주세요." }, { status: 400 });
    }

    const hfKey = normalizeHfKey(env("HF_API_KEY"));
    if (!hfKey) throw new Error("HIGGSFIELD_AUTH:Higgsfield API 키가 비어 있습니다.");
    await verifyHiggsfieldCredential(hfKey);

    const videoRes = await fetch(HF_SUBMIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${hfKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        urls: [youtubeUrl],
        clips_num: CLIP_COUNT,
        clip_aspect: aspectRatio,
        subtitle_highlight_hex: brandColor,
        subtitle_position: "bottom",
        subtitle_font: "notosans",
        subtitle_case: "as-is",
        track_face_crop: true,
        max_height: 1080,
        segment_seconds: 10
      })
    });

    const data = await videoRes.json().catch(() => ({}));
    if (!videoRes.ok) {
      throw new Error(
        `HIGGSFIELD:HTTP ${videoRes.status} · ${providerMessage(data) || "Clipify 요청이 거절되었습니다."}`
      );
    }

    const jobId = jobIdFrom(data);
    const inlineClips = extractClipEntries(data);

    if (!jobId) {
      if (inlineClips.length) {
        return NextResponse.json({
          status: "completed",
          inline: true,
          clips: inlineClips.map(({ url, ...meta }) => ({ ...meta, url })),
          clipCount: inlineClips.length,
          provider: "higgsfield",
          model: HF_MODEL,
          mode: "youtube_autoclip"
        });
      }
      throw new Error(
        `HIGGSFIELD:Clipify 작업 ID를 받지 못했습니다. 응답: ${providerMessage(data) || "unknown"}`
      );
    }

    return NextResponse.json({
      jobId,
      accessToken: signAccess(user.id, jobId),
      status: normalizeStatus(data?.status || data?.state || "queued"),
      progress: Number(data?.progress || 0),
      clipCount: CLIP_COUNT,
      provider: "higgsfield",
      model: HF_MODEL,
      mode: "youtube_autoclip"
    });
  } catch (error) {
    const message = String(error?.message || "YouTube 자동 쇼츠 생성 중 오류가 발생했습니다.");
    const lower = message.toLowerCase();

    const friendly =
      message.startsWith("HIGGSFIELD_AUTH:")
        ? "Higgsfield API 키 인증 실패: " + message.replace("HIGGSFIELD_AUTH:", "")
        : message.startsWith("HIGGSFIELD:")
          ? "Higgsfield Clipify 오류: " + message.replace("HIGGSFIELD:", "")
          : message.includes("HF_API_KEY")
            ? "Higgsfield API 키가 아직 연결되지 않았습니다."
            : lower.includes("balance") || lower.includes("billing") || lower.includes("credit") || lower.includes("quota")
              ? "Higgsfield API 잔액 또는 결제 설정을 확인해주세요."
              : message;

    return NextResponse.json({ message: friendly }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const jobId = String(searchParams.get("jobId") || "");
    const accessToken = String(searchParams.get("token") || "");
    const action = String(searchParams.get("action") || "status");
    const index = Math.max(0, Number(searchParams.get("index") || 0));

    if (!jobId || !validAccess(user.id, jobId, accessToken)) {
      return NextResponse.json({ message: "쇼츠 작업 접근 권한을 확인할 수 없습니다." }, { status: 403 });
    }

    const hfKey = normalizeHfKey(env("HF_API_KEY"));
    const { res: statusRes, data } = await hfStatus(jobId, hfKey);

    if (!statusRes.ok) {
      return NextResponse.json(
        { message: `Higgsfield 상태 조회 오류: HTTP ${statusRes.status} · ${providerMessage(data)}` },
        { status: statusRes.status }
      );
    }

    const status = normalizeStatus(data?.status || data?.state);
    const clips = extractClipEntries(data);

    if (action === "content") {
      if (status !== "completed") {
        return NextResponse.json(
          { message: status === "failed" ? "Clipify 쇼츠 생성이 실패했습니다." : "쇼츠가 아직 완성되지 않았습니다." },
          { status: status === "failed" ? 500 : 409 }
        );
      }

      const target = clips[index];
      if (!target?.url) {
        return NextResponse.json(
          { message: `완성된 쇼츠 #${index + 1} 영상 주소를 찾지 못했습니다.` },
          { status: 404 }
        );
      }

      const contentRes = await fetch(target.url, { cache: "no-store" });
      if (!contentRes.ok) {
        return NextResponse.json(
          { message: "완성된 쇼츠 영상을 불러오지 못했습니다." },
          { status: contentRes.status }
        );
      }

      const bytes = await contentRes.arrayBuffer();
      return new Response(bytes, {
        headers: {
          "Content-Type": contentRes.headers.get("content-type") || "video/mp4",
          "Content-Disposition": `inline; filename="WEARON_CLIP_${index + 1}.mp4"`,
          "Cache-Control": "private, no-store"
        }
      });
    }

    const rawError =
      (typeof data?.error === "string" ? data.error : null) ||
      data?.error?.message ||
      data?.fail_reason ||
      data?.failure_reason ||
      data?.error_message ||
      data?.reason ||
      data?.detail ||
      data?.message ||
      data?.provider_error ||
      data?.result?.error ||
      null;

    const progressRaw = Number(data?.progress || 0);
    const progress = progressRaw > 0
      ? Math.max(0, Math.min(100, progressRaw))
      : status === "completed"
        ? 100
        : status === "processing"
          ? 60
          : 20;

    return NextResponse.json({
      id: jobId,
      status,
      progress,
      clipCount: clips.length,
      clips: clips.map(({ url, ...meta }) => meta),
      error: status === "failed"
        ? { message: String(rawError || "Clipify 쇼츠 생성이 실패했습니다.").slice(0, 500) }
        : null,
      provider: "higgsfield",
      model: HF_MODEL
    });
  } catch (error) {
    return NextResponse.json(
      { message: String(error?.message || "쇼츠 작업 상태 확인 중 오류가 발생했습니다.") },
      { status: 500 }
    );
  }
}
