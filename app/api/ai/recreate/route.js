import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/paymentServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경 변수가 없습니다.`);
  return value;
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

function videoSize(aspectRatio) {
  return aspectRatio === "16:9" ? "1280x720" : "720x1280";
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
    const aspectRatio = String(body?.aspectRatio || "9:16");
    const hookLanguage = String(body?.hookLanguage || "ko");
    const brandColor = String(body?.brandColor || "#7c5cff");

    if (!title) {
      return NextResponse.json({ message: "YouTube 영상 정보를 먼저 불러와주세요." }, { status: 400 });
    }

    const openaiKey = env("OPENAI_API_KEY");
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
          `Create an ORIGINAL short-form video concept based only on the topic and public metadata provided. Do not reproduce, imitate, quote, or reconstruct footage from the source video. Do not copy logos, watermarks, private people, distinctive copyrighted characters, or a living artist's style. The result should feel like a fresh social short, with a clear opening hook and visually dynamic scenes. Write the hook, thumbnail title/subtitle, and 2-3 short natural reaction comments in ${language}. The comments are fictional AI-generated reactions for a visual template: never invent usernames, like counts, or claim they are real viewer comments. Keep comments short enough for a vertical social-video overlay. The Sora prompt must describe a self-contained 12-second video with synced natural audio/dialogue if appropriate, vertical-first composition unless 16:9 is requested, and no on-screen copyrighted branding or fake social comments because WEARON overlays those separately. Style preference: ${template}.`,
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
        planningData?.error?.message ||
        planningData?.message ||
        "AI 영상 기획에 실패했습니다."
      );
    }

    let plan;
    try {
      plan = JSON.parse(responseText(planningData));
    } catch {
      throw new Error("AI 영상 기획 결과를 읽지 못했습니다.");
    }

    const form = new FormData();
    form.append("model", "sora-2");
    form.append("prompt", String(plan?.video_prompt || title).slice(0, 4000));
    form.append("seconds", "12");
    form.append("size", videoSize(aspectRatio));

    const videoRes = await fetch("https://api.openai.com/v1/videos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`
      },
      body: form
    });

    const video = await videoRes.json().catch(() => ({}));
    if (!videoRes.ok) {
      throw new Error(
        video?.error?.message ||
        video?.message ||
        "AI 영상 생성을 시작하지 못했습니다."
      );
    }

    const jobId = String(video?.id || "");
    if (!jobId) throw new Error("AI 영상 작업 ID를 받지 못했습니다.");

    return NextResponse.json({
      jobId,
      accessToken: signAccess(user.id, jobId),
      status: video?.status || "queued",
      progress: Number(video?.progress || 0),
      hook: String(plan?.hook || "AI 쇼츠").slice(0, 100),
      summary: String(plan?.summary || "").slice(0, 500),
      thumbnailTitle: String(plan?.thumbnail_title || plan?.hook || "AI 쇼츠").slice(0, 48),
      thumbnailSubtitle: String(plan?.thumbnail_subtitle || "").slice(0, 48),
      comments: (Array.isArray(plan?.comments) ? plan.comments : [])
        .slice(0, 3)
        .map((comment) => String(comment).slice(0, 90)),
      seconds: 12,
      size: videoSize(aspectRatio),
      mode: "ai_recreation"
    });
  } catch (error) {
    const message = String(error?.message || "AI 쇼츠 생성 중 오류가 발생했습니다.");
    const lower = message.toLowerCase();
    const friendly =
      lower.includes("billing") || lower.includes("credit") || lower.includes("quota")
        ? "OpenAI API 크레딧 또는 결제 설정을 확인해주세요."
        : lower.includes("sora") && lower.includes("access")
          ? "현재 OpenAI API 프로젝트에서 Sora 2 영상 생성 권한을 사용할 수 없습니다."
          : message.includes("OPENAI_API_KEY")
            ? "OPENAI_API_KEY가 설정되지 않았습니다."
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

    const openaiKey = env("OPENAI_API_KEY");

    if (action === "content") {
      const contentRes = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(jobId)}/content`, {
        headers: { Authorization: `Bearer ${openaiKey}` },
        cache: "no-store"
      });

      if (!contentRes.ok) {
        const detail = await contentRes.text();
        return NextResponse.json(
          { message: detail || "완성된 영상을 불러오지 못했습니다." },
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

    const statusRes = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${openaiKey}` },
      cache: "no-store"
    });

    const video = await statusRes.json().catch(() => ({}));
    if (!statusRes.ok) {
      return NextResponse.json(
        { message: video?.error?.message || video?.message || "AI 영상 상태를 확인하지 못했습니다." },
        { status: statusRes.status }
      );
    }

    return NextResponse.json({
      id: video?.id,
      status: video?.status,
      progress: Number(video?.progress || 0),
      error: video?.error || null,
      seconds: video?.seconds || "12",
      size: video?.size || null
    });
  } catch (error) {
    return NextResponse.json(
      { message: String(error?.message || "AI 영상 상태 확인 중 오류가 발생했습니다.") },
      { status: 500 }
    );
  }
}
