import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/paymentServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HF_MODEL = "clipify";
const HF_SUBMIT_URL = "https://api.higgsfield.ai/clipify";
const CLIP_COUNT = 4;

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
  return true;
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

function responseText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  return (data?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((part) => part?.type === "output_text" && typeof part?.text === "string")
    .map((part) => part.text)
    .join("");
}

function normalizeAspectRatio(value) {
  return ["9:16", "16:9", "1:1"].includes(value) ? value : "9:16";
}

function normalizeStatus(value) {
  const raw = String(value || "queued").toLowerCase();
  if (["completed", "succeeded", "success"].includes(raw)) return "completed";
  if (["failed", "error", "nsfw", "canceled", "cancelled"].includes(raw)) return "failed";
  if (["processing", "running", "in_progress", "in-progress"].includes(raw)) return "processing";
  return "queued";
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

function extractClipEntries(data) {
  const found = [];
  const seen = new Set();

  const add = (url, meta = {}) => {
    const value = String(url || "").trim();
    if (!/^https?:\/\//i.test(value)) return;
    if (/\/requests\/.*\/(status|cancel)/i.test(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    found.push({
      url: value,
      duration: Number(meta?.duration || meta?.duration_seconds || meta?.seconds || 0) || 0,
      start: Number(meta?.start || meta?.start_seconds || 0) || 0,
      end: Number(meta?.end || meta?.end_seconds || 0) || 0,
      title: String(meta?.title || meta?.hook || meta?.name || "").slice(0, 120)
    });
  };

  const walk = (node, path = "") => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof node !== "object") return;

    const lowerPath = path.toLowerCase();
    const rejectVisual = /(thumbnail|poster|image|cover)/.test(lowerPath);

    for (const [key, value] of Object.entries(node)) {
      const nextPath = path ? `${path}.${key}` : key;
      const lowerKey = key.toLowerCase();

      if (typeof value === "string" && /^https?:\/\//i.test(value)) {
        const mediaish =
          /(video|clip|output|result)/.test(nextPath.toLowerCase()) ||
          /^(url|video_url|clip_url|file_url)$/.test(lowerKey);
        const blocked =
          /(thumbnail|poster|image|cover|status_url|cancel_url|upload_url)/.test(nextPath.toLowerCase());
        if (mediaish && !blocked && !rejectVisual) add(value, node);
      } else {
        walk(value, nextPath);
      }
    }
  };

  walk(data);
  return found.slice(0, 20);
}

async function buildSocialPackages({
  openaiKey,
  title,
  description,
  channelTitle,
  tags,
  language,
  template
}) {
  const fallback = Array.from({ length: CLIP_COUNT }, (_, index) => ({
    hook: `핵심 쇼츠 #${index + 1}`,
    summary: "원본 영상에서 핵심 장면을 자동으로 추출한 쇼츠입니다.",
    thumbnailTitle: title.slice(0, 42) || `핵심 쇼츠 #${index + 1}`,
    thumbnailSubtitle: "핵심 장면",
    comments: ["여기가 핵심이네", "이 장면 다시 보게 되네요 ㅋㅋ"]
  }));

  try {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        clips: {
          type: "array",
          minItems: CLIP_COUNT,
          maxItems: CLIP_COUNT,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              hook: { type: "string" },
              summary: { type: "string" },
              thumbnail_title: { type: "string" },
              thumbnail_subtitle: { type: "string" },
              comments: {
                type: "array",
                minItems: 2,
                maxItems: 3,
                items: { type: "string" }
              }
            },
            required: ["hook", "summary", "thumbnail_title", "thumbnail_subtitle", "comments"]
          }
        }
      },
      required: ["clips"]
    };

    const planningRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        instructions:
          `Prepare exactly ${CLIP_COUNT} concise social-short packaging ideas for clips extracted from one YouTube video. Write in ${language}. Each item needs a hook, one-sentence highlight summary, thumbnail title/subtitle, and 2-3 short natural reaction comments. Comments are fictional AI-generated overlay copy only: never invent usernames, like counts, or claim they came from real viewers. Do not invent specific facts that are not supported by the public metadata. Style preference: ${template}.`,
        input: JSON.stringify({
          source_title: title,
          source_description: description.slice(0, 5000),
          source_channel: channelTitle,
          source_tags: tags
        }),
        text: {
          format: {
            type: "json_schema",
            name: "wearon_clipify_social_pack",
            strict: true,
            schema
          }
        }
      })
    });

    const planningData = await planningRes.json().catch(() => ({}));
    if (!planningRes.ok) return fallback;

    const parsed = JSON.parse(responseText(planningData));
    const clips = Array.isArray(parsed?.clips) ? parsed.clips : [];
    if (clips.length !== CLIP_COUNT) return fallback;

    return clips.map((clip, index) => ({
      hook: String(clip?.hook || fallback[index].hook).slice(0, 100),
      summary: String(clip?.summary || fallback[index].summary).slice(0, 500),
      thumbnailTitle: String(clip?.thumbnail_title || fallback[index].thumbnailTitle).slice(0, 48),
      thumbnailSubtitle: String(clip?.thumbnail_subtitle || fallback[index].thumbnailSubtitle).slice(0, 48),
      comments: (Array.isArray(clip?.comments) ? clip.comments : fallback[index].comments)
        .slice(0, 3)
        .map((comment) => String(comment).slice(0, 90))
    }));
  } catch {
    return fallback;
  }
}

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();

    const youtubeUrl = String(body?.youtubeUrl || "").trim();
    const title = String(body?.title || "").trim();
    const description = String(body?.description || "").trim();
    const channelTitle = String(body?.channelTitle || "").trim();
    const tags = Array.isArray(body?.tags) ? body.tags.slice(0, 12).map(String) : [];
    const template = String(body?.template || "자막 강조");
    const aspectRatio = normalizeAspectRatio(String(body?.aspectRatio || "9:16"));
    const hookLanguage = String(body?.hookLanguage || "ko");
    const brandColor = String(body?.brandColor || "#7c5cff");

    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(youtubeUrl)) {
      return NextResponse.json({ message: "유효한 YouTube 링크를 입력해주세요." }, { status: 400 });
    }

    const openaiKey = env("OPENAI_API_KEY");
    const hfKey = normalizeHfKey(env("HF_API_KEY"));

    if (!hfKey) {
      throw new Error("HIGGSFIELD_AUTH:Higgsfield API 키가 비어 있습니다.");
    }
    if (!hfKey.includes(":")) {
      throw new Error(
        "HIGGSFIELD_AUTH:API 키 전체값이 아닙니다. Higgsfield의 Copy API key 버튼으로 전체 키를 다시 복사해주세요."
      );
    }

    await verifyHiggsfieldCredential(hfKey);

    const language =
      hookLanguage === "en" ? "English" :
      hookLanguage === "ja" ? "Japanese" : "Korean";

    const clipifyPromise = fetch(HF_SUBMIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${hfKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        urls: [youtubeUrl],
        clips_num: CLIP_COUNT,
        clip_aspect: aspectRatio,
        subtitle_highlight_hex: /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : "#FFE84D",
        subtitle_position: "bottom",
        subtitle_font: "notosans",
        subtitle_case: "as-is",
        track_face_crop: true,
        max_height: 1080,
        segment_seconds: 10
      })
    });

    const socialPromise = buildSocialPackages({
      openaiKey,
      title,
      description,
      channelTitle,
      tags,
      language,
      template
    });

    const [clipifyRes, socialPackages] = await Promise.all([clipifyPromise, socialPromise]);
    const clipify = await clipifyRes.json().catch(() => ({}));

    if (!clipifyRes.ok) {
      throw new Error(
        "HIGGSFIELD:" +
        (
          clipify?.error?.message ||
          clipify?.detail ||
          clipify?.message ||
          "Clipify 쇼츠 생성을 시작하지 못했습니다."
        )
      );
    }

    const jobId = String(clipify?.request_id || clipify?.id || "");
    if (!jobId) throw new Error("Clipify 작업 ID를 받지 못했습니다.");

    return NextResponse.json({
      jobId,
      accessToken: signAccess(user.id, jobId),
      status: normalizeStatus(clipify?.status || "queued"),
      progress: Number(clipify?.progress || 0),
      clipCount: CLIP_COUNT,
      socialPackages,
      provider: "higgsfield",
      model: HF_MODEL,
      mode: "youtube_clipify"
    });
  } catch (error) {
    const message = String(error?.message || "YouTube 쇼츠 생성 중 오류가 발생했습니다.");
    const lower = message.toLowerCase();
    const friendly =
      message.includes("HF_API_KEY")
        ? "Higgsfield API 키가 아직 연결되지 않았습니다. Vercel에 HF_API_KEY를 추가해주세요."
        : message.startsWith("HIGGSFIELD_AUTH:")
          ? "Higgsfield API 키 인증 실패: " + message.replace("HIGGSFIELD_AUTH:", "")
          : message.startsWith("HIGGSFIELD:")
            ? "Higgsfield 오류: " + message.replace("HIGGSFIELD:", "")
            : message.includes("OPENAI_API_KEY")
              ? "OPENAI_API_KEY가 설정되지 않았습니다."
              : lower.includes("balance") || lower.includes("billing") || lower.includes("credit") || lower.includes("quota")
                ? "Higgsfield/OpenAI API 잔액 또는 결제 설정을 확인해주세요."
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
        { message: data?.error?.message || data?.detail || data?.message || "쇼츠 작업 상태를 확인하지 못했습니다." },
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
          { message: "완성된 쇼츠 영상 주소를 찾지 못했습니다." },
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

    const errorMessage =
      rawError ||
      (status === "failed" ? "Clipify 쇼츠 생성이 실패했습니다." : null);

    const rawProgress = Number(data?.progress || 0);
    const progress = rawProgress > 0
      ? Math.max(0, Math.min(100, rawProgress))
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
      error: status === "failed" ? {
        message: errorMessage,
        providerStatus: data?.status || data?.state || null
      } : null,
      provider: "higgsfield",
      model: HF_MODEL
    });
  } catch (error) {
    const message = String(error?.message || "쇼츠 작업 상태 확인 중 오류가 발생했습니다.");
    return NextResponse.json({ message }, { status: 500 });
  }
}
