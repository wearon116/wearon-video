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

function encodeStoragePath(path) {
  return String(path || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function responseText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  return (data?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((part) => part?.type === "output_text" && typeof part?.text === "string")
    .map((part) => part.text)
    .join("");
}

function cleanClip(clip, duration, index, lowerBound = 0, upperBound = null) {
  const maxDuration = Number.isFinite(duration) && duration > 0 ? duration : 3600;
  const lower = Math.max(0, Number(lowerBound) || 0);
  const upper = Math.min(maxDuration, Number.isFinite(Number(upperBound)) && Number(upperBound) > lower ? Number(upperBound) : maxDuration);
  let start = Math.max(lower, Number(clip?.start || lower));
  let end = Math.max(start + 8, Number(clip?.end || start + 20));

  start = Math.min(start, Math.max(lower, upper - 8));
  end = Math.min(end, upper);

  if (end - start < 8) end = Math.min(upper, start + 8);
  if (end - start > 60) end = start + 60;

  return {
    id: index + 1,
    score: Math.max(1, Math.min(100, Math.round(Number(clip?.score || 80)))),
    start: Number(start.toFixed(2)),
    duration: Number((end - start).toFixed(2)),
    hook: String(clip?.hook || `AI 추천 구간 ${index + 1}`).slice(0, 80),
    reason: String(clip?.reason || "").slice(0, 240)
  };
}

export async function POST(request) {
  let sourcePath = "";
  try {
    const user = await requireUser(request);
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    const body = await request.json();

    sourcePath = String(body?.sourcePath || "");
    const filename = String(body?.filename || "source-video.mp4");
    const mimeType = String(body?.mimeType || "video/mp4");
    const duration = Number(body?.duration || 0);
    const analysisStart = Math.max(0, Number(body?.analysisStart || 0));
    const requestedEnd = Number(body?.analysisEnd || 0);
    const analysisEnd =
      requestedEnd > analysisStart
        ? Math.min(requestedEnd, duration > 0 ? duration : requestedEnd)
        : duration > 0
          ? duration
          : 3600;
    const hookLanguage = String(body?.hookLanguage || "ko");
    const template = String(body?.template || "자막 강조");
    const aspectRatio = String(body?.aspectRatio || "9:16");

    if (!sourcePath || !sourcePath.startsWith(`${user.id}/`)) {
      return NextResponse.json({ message: "원본 영상 경로가 올바르지 않습니다." }, { status: 400 });
    }

    const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
    const publishableKey = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    const openaiKey = env("OPENAI_API_KEY");

    const sourceRes = await fetch(
      `${supabaseUrl}/storage/v1/object/authenticated/source-videos/${encodeStoragePath(sourcePath)}`,
      {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      }
    );

    if (!sourceRes.ok) {
      const detail = await sourceRes.text();
      throw new Error(`원본 영상을 불러오지 못했습니다. ${detail.slice(0, 180)}`);
    }

    const sourceBlob = await sourceRes.blob();

    const transcriptionForm = new FormData();
    transcriptionForm.append(
      "file",
      new File([sourceBlob], filename, { type: mimeType || sourceBlob.type || "video/mp4" })
    );
    transcriptionForm.append("model", "gpt-4o-transcribe-diarize");
    transcriptionForm.append("response_format", "diarized_json");
    transcriptionForm.append("chunking_strategy", "auto");

    const transcriptionRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`
      },
      body: transcriptionForm
    });

    const transcriptionData = await transcriptionRes.json().catch(() => ({}));
    if (!transcriptionRes.ok) {
      const detail =
        transcriptionData?.error?.message ||
        transcriptionData?.message ||
        "음성 분석 요청에 실패했습니다.";
      throw new Error(detail);
    }

    const segments = Array.isArray(transcriptionData?.segments)
      ? transcriptionData.segments
          .map((segment) => ({
            start: Number(segment?.start || 0),
            end: Number(segment?.end || 0),
            text: String(segment?.text || "").trim(),
            speaker: String(segment?.speaker || "")
          }))
          .filter((segment) => segment.text && segment.end > segment.start)
      : [];

    if (!segments.length && transcriptionData?.text) {
      segments.push({
        start: 0,
        end: duration > 0 ? duration : 60,
        text: String(transcriptionData.text),
        speaker: ""
      });
    }

    if (!segments.length) {
      throw new Error("영상에서 분석할 음성을 찾지 못했습니다.");
    }

    const scopedSegments = segments.filter(
      (segment) => segment.end >= analysisStart && segment.start <= analysisEnd
    );

    if (!scopedSegments.length) {
      throw new Error("선택한 구간에서 분석할 음성을 찾지 못했습니다.");
    }

    const transcriptForModel = scopedSegments
      .map((segment) => {
        const speaker = segment.speaker ? ` ${segment.speaker}` : "";
        return `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}]${speaker}: ${segment.text}`;
      })
      .join("\n")
      .slice(0, 120000);

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        clips: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              start: { type: "number" },
              end: { type: "number" },
              score: { type: "integer", minimum: 1, maximum: 100 },
              hook: { type: "string" },
              reason: { type: "string" }
            },
            required: ["start", "end", "score", "hook", "reason"]
          }
        }
      },
      required: ["clips"]
    };

    const analysisRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        instructions:
          `You are an expert short-form video editor. Pick exactly 3 distinct, non-overlapping highlight clips from the timestamped transcript. Each clip should normally be 15-45 seconds, must be understandable on its own, start with a strong hook when possible, avoid filler, and prioritize emotional reaction, surprising information, clear payoff, controversy, humor, or a useful insight. Use only timestamps supported by the transcript and stay inside the requested analysis range. Create hook text in ${hookLanguage === "en" ? "English" : hookLanguage === "ja" ? "Japanese" : "Korean"}. The selected visual style is ${template} and output aspect ratio is ${aspectRatio}; reflect the style in concise hook wording but do not invent facts.`,
        input: `영상 전체 길이: ${duration || "unknown"}초\n분석 범위: ${analysisStart}-${analysisEnd}초\n템플릿: ${template}\n화면비: ${aspectRatio}\n\n타임스탬프 전사:\n${transcriptForModel}`,
        text: {
          format: {
            type: "json_schema",
            name: "shorts_candidates",
            strict: true,
            schema
          }
        }
      })
    });

    const analysisData = await analysisRes.json().catch(() => ({}));
    if (!analysisRes.ok) {
      const detail =
        analysisData?.error?.message ||
        analysisData?.message ||
        "AI 하이라이트 분석에 실패했습니다.";
      throw new Error(detail);
    }

    const text = responseText(analysisData);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("AI 분석 결과를 읽지 못했습니다.");
    }

    const clips = (parsed?.clips || []).slice(0, 3).map((clip, index) => {
      const cleaned = cleanClip(clip, duration, index, analysisStart, analysisEnd);
      const clipEnd = cleaned.start + cleaned.duration;
      const captions = scopedSegments
        .filter((segment) => segment.end >= cleaned.start && segment.start <= clipEnd)
        .map((segment) => ({
          start: Number(Math.max(cleaned.start, segment.start).toFixed(2)),
          end: Number(Math.min(clipEnd, segment.end).toFixed(2)),
          text: segment.text.slice(0, 180)
        }))
        .filter((segment) => segment.end > segment.start);

      return {
        ...cleaned,
        captions,
        transcript: captions.map((caption) => caption.text).join(" ")
      };
    });

    if (clips.length !== 3) {
      throw new Error("AI가 충분한 쇼츠 후보를 만들지 못했습니다.");
    }

    return NextResponse.json({
      clips,
      transcriptionModel: "gpt-4o-transcribe-diarize",
      selectionModel: "gpt-5-mini"
    });
  } catch (error) {
    const message = String(error?.message || "AI 쇼츠 분석 중 오류가 발생했습니다.");
    const friendly =
      message.toLowerCase().includes("maximum") || message.toLowerCase().includes("size")
        ? "영상 파일이 AI 분석 한도를 초과했습니다. 더 짧거나 용량이 작은 원본으로 다시 시도해주세요."
        : message.includes("OPENAI_API_KEY")
          ? "AI 엔진 연결용 OPENAI_API_KEY가 아직 설정되지 않았습니다."
          : message;

    return NextResponse.json({ message: friendly, sourcePath }, { status: 500 });
  }
}
