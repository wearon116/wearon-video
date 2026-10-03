import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/paymentServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HF_MODEL = "kling-video/v3.0/std/text-to-video";
const HF_SUBMIT_URL = `https://api.higgsfield.ai/${HF_MODEL}`;

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

  // A non-existent request normally returns 404 when authentication is valid.
  // Any non-auth status means the credential itself was accepted.
  return true;
}

function signAccess(userId, jobId) {
  return createHmac("sha256", env("SUPABASE_SECRET_KEY"))
    .update(`wearon-ai-video:${userId}:${jobId}`)
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

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const body = await request.json();

    const title = String(body?.title || "").trim();
    const description = String(body?.description || "").trim();
    const channelTitle = String(body?.channelTitle || "").trim();
    const tags = Array.isArray(body?.tags) ? body.tags.slice(0, 12).map(String) : [];
    const template = String(body?.template || "자막 강조");
    const aspectRatio = normalizeAspectRatio(String(body?.aspectRatio || "9:16"));
    const hookLanguage = String(body?.hookLanguage || "ko");
    const brandColor = String(body?.brandColor || "#7c5cff");

    if (!title) {
      return NextResponse.json({ message: "YouTube 영상 정보를 먼저 불러와주세요." }, { status: 400 });
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

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        hook: { type: "string" },
        summary: { type: "string" },
        video_prompt: { type: "string" },
        thumbnail_title: { type: "string" },
        thumbnail_subtitle: { type: "string" },
        comments: {
          type: "array",
          minItems: 2,
          maxItems: 3,
          items: { type: "string" }
        }
      },
      required: ["hook", "summary", "video_prompt", "thumbnail_title", "thumbnail_subtitle", "comments"]
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
          `Create an ORIGINAL short-form video concept based only on the topic and public metadata provided. Do not reproduce, imitate, quote, or reconstruct footage from the source video. Do not copy logos, watermarks, private people, distinctive copyrighted characters, or a living artist's style. The result should feel like a fresh social short, with a clear opening hook and visually dynamic scenes. Write the hook, thumbnail title/subtitle, and 2-3 short natural reaction comments in ${language}. The comments are fictional AI-generated reactions for a visual template: never invent usernames, like counts, or claim they are real viewer comments. Keep comments short enough for a vertical social-video overlay. The video prompt must describe a self-contained 12-second video with natural movement and native audio/dialogue if appropriate, vertical-first composition unless 16:9 is requested, and no copyrighted branding or fake social comments because WEARON overlays those separately. Style preference: ${template}.`,
        input: JSON.stringify({
          source_title: title,
          source_description: description.slice(0, 6000),
          source_channel: channelTitle,
          source_tags: tags,
          requested_aspect_ratio: aspectRatio,
          preferred_color_palette: brandColor
        }),
        text: {
          format: {
            type: "json_schema",
            name: "wearon_recreated_short",
            strict: true,
            schema
          }
        }
      })
    });

    const planningData = await planningRes.json().catch(() => ({}));
    if (!planningRes.ok) {
      throw new Error(
        "OPENAI:" +
        (
          planningData?.error?.message ||
          planningData?.message ||
          "AI 영상 기획에 실패했습니다."
        )
      );
    }

    let plan;
    try {
      plan = JSON.parse(responseText(planningData));
    } catch {
      throw new Error("AI 영상 기획 결과를 읽지 못했습니다.");
    }

    const videoRes = await fetch(HF_SUBMIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${hfKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: String(plan?.video_prompt || title).slice(0, 4000),
        sound: "on",
        duration: 12,
        cfg_scale: 0.5,
        multi_shots: true,
        aspect_ratio: aspectRatio
      })
    });

    const video = await videoRes.json().catch(() => ({}));
    if (!videoRes.ok) {
      throw new Error(
        "HIGGSFIELD:" +
        (
          video?.error?.message ||
          video?.detail ||
          video?.message ||
          "Higgsfield 영상 생성을 시작하지 못했습니다."
        )
      );
    }

    const jobId = String(video?.request_id || video?.id || "");
    if (!jobId) throw new Error("Higgsfield 영상 작업 ID를 받지 못했습니다.");

    return NextResponse.json({
      jobId,
      accessToken: signAccess(user.id, jobId),
      status: normalizeStatus(video?.status || "queued"),
      progress: Number(video?.progress || 0),
      hook: String(plan?.hook || "AI 쇼츠").slice(0, 100),
      summary: String(plan?.summary || "").slice(0, 500),
      thumbnailTitle: String(plan?.thumbnail_title || plan?.hook || "AI 쇼츠").slice(0, 48),
      thumbnailSubtitle: String(plan?.thumbnail_subtitle || "").slice(0, 48),
      comments: (Array.isArray(plan?.comments) ? plan.comments : [])
        .slice(0, 3)
        .map((comment) => String(comment).slice(0, 90)),
      seconds: 12,
      aspectRatio,
      provider: "higgsfield",
      model: HF_MODEL,
      mode: "ai_recreation"
    });
  } catch (error) {
    const message = String(error?.message || "AI 쇼츠 생성 중 오류가 발생했습니다.");
    const lower = message.toLowerCase();
    const friendly =
      message.includes("HF_API_KEY")
        ? "Higgsfield API 키가 아직 연결되지 않았습니다. Vercel에 HF_API_KEY를 추가해주세요."
        : message.startsWith("HIGGSFIELD_AUTH:")
          ? "Higgsfield API 키 인증 실패: " + message.replace("HIGGSFIELD_AUTH:", "")
          : message.startsWith("HIGGSFIELD:")
            ? "Higgsfield 오류: " + message.replace("HIGGSFIELD:", "")
            : message.startsWith("OPENAI:")
              ? "OpenAI 오류: " + message.replace("OPENAI:", "")
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

    if (!jobId || !validAccess(user.id, jobId, accessToken)) {
      return NextResponse.json({ message: "AI 영상 접근 권한을 확인할 수 없습니다." }, { status: 403 });
    }

    const hfKey = normalizeHfKey(env("HF_API_KEY"));
    const { res: statusRes, data } = await hfStatus(jobId, hfKey);

    if (!statusRes.ok) {
      return NextResponse.json(
        { message: data?.error?.message || data?.detail || data?.message || "AI 영상 상태를 확인하지 못했습니다." },
        { status: statusRes.status }
      );
    }

    const status = normalizeStatus(data?.status || data?.state);
    const videoUrl =
      data?.video?.url ||
      data?.result?.video?.url ||
      data?.output?.video?.url ||
      data?.video_url ||
      "";

    if (action === "content") {
      if (status !== "completed" || !videoUrl) {
        return NextResponse.json(
          { message: status === "failed" ? "AI 영상 생성이 실패했습니다." : "AI 영상이 아직 완성되지 않았습니다." },
          { status: status === "failed" ? 500 : 409 }
        );
      }

      const contentRes = await fetch(videoUrl, { cache: "no-store" });
      if (!contentRes.ok) {
        return NextResponse.json(
          { message: "완성된 AI 영상을 불러오지 못했습니다." },
          { status: contentRes.status }
        );
      }

      const bytes = await contentRes.arrayBuffer();
      return new Response(bytes, {
        headers: {
          "Content-Type": contentRes.headers.get("content-type") || "video/mp4",
          "Content-Disposition": 'inline; filename="WEARON_AI_SHORT.mp4"',
          "Cache-Control": "private, no-store"
        }
      });
    }

    const errorMessage =
      data?.error?.message ||
      data?.detail ||
      data?.message ||
      (status === "failed" ? "Higgsfield 영상 생성이 실패했습니다." : null);

    return NextResponse.json({
      id: jobId,
      status,
      progress: Number(data?.progress || (status === "completed" ? 100 : 0)),
      error: status === "failed" ? { message: errorMessage } : null,
      seconds: 12,
      provider: "higgsfield",
      model: HF_MODEL
    });
  } catch (error) {
    const message = String(error?.message || "AI 영상 상태 확인 중 오류가 발생했습니다.");
    return NextResponse.json({ message }, { status: 500 });
  }
}
