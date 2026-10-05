import { NextResponse } from "next/server";
import {
  createSignedClipUrl,
  getClipSource,
  logPublish,
  refreshConnectionIfNeeded,
  requireUser,
  updatePublish
} from "../../../../lib/channelServer";

export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=60;

function cleanText(value,max=5000){
  return String(value||"").trim().slice(0,max);
}

async function publishYoutube(userId,clipId,options,eventId){
  const connection=await refreshConnectionIfNeeded(userId,"youtube");
  const {file,title:clipTitle}=await getClipSource(userId,clipId);
  const accessToken=connection.accessToken;
  const title=cleanText(options.title||clipTitle,100)||"WEARON VIDEO 쇼츠";
  const description=cleanText(options.description||"",5000);
  const privacy=["private","unlisted","public"].includes(options.privacy)?options.privacy:"private";
  const metadata={
    snippet:{title,description,categoryId:"22"},
    status:{privacyStatus:privacy,selfDeclaredMadeForKids:false}
  };

  const init=await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",{
    method:"POST",
    headers:{
      Authorization:"Bearer "+accessToken,
      "Content-Type":"application/json; charset=UTF-8",
      "X-Upload-Content-Type":file.headers.get("content-type")||"video/mp4",
      ...(file.headers.get("content-length")?{"X-Upload-Content-Length":file.headers.get("content-length")}:{})
    },
    body:JSON.stringify(metadata),
    cache:"no-store"
  });
  const uploadUrl=init.headers.get("location");
  if(!init.ok||!uploadUrl){
    const detail=await init.text();
    throw new Error("YouTube 업로드 준비에 실패했습니다. "+detail.slice(0,160));
  }

  await updatePublish(eventId,{status:"uploading"});
  const upload=await fetch(uploadUrl,{
    method:"PUT",
    headers:{
      "Content-Type":file.headers.get("content-type")||"video/mp4",
      ...(file.headers.get("content-length")?{"Content-Length":file.headers.get("content-length")}:{})
    },
    body:file.body,
    duplex:"half"
  });
  const data=await upload.json().catch(()=>({}));
  if(!upload.ok||!data.id) throw new Error("YouTube 영상 업로드에 실패했습니다.");
  await updatePublish(eventId,{status:"published",providerPostId:data.id,metadata:{privacy,url:"https://youtu.be/"+data.id}});
  return {
    status:"published",
    message:"YouTube 업로드가 완료되었습니다.",
    postId:data.id,
    url:"https://youtu.be/"+data.id,
    note:privacy==="public"?"공개 상태로 요청했습니다. API 프로젝트 검증 상태에 따라 비공개로 제한될 수 있습니다.":"설정한 공개 범위로 업로드했습니다."
  };
}

async function publishInstagram(userId,clipId,options,eventId){
  const connection=await refreshConnectionIfNeeded(userId,"instagram");
  const {path,title:clipTitle}=await getClipSource(userId,clipId);
  const signedUrl=await createSignedClipUrl(path,3600);
  const caption=cleanText(options.caption||options.title||clipTitle,2200);

  const params=new URLSearchParams({
    media_type:"REELS",
    video_url:signedUrl,
    caption,
    share_to_feed:options.shareToFeed===false?"false":"true",
    access_token:connection.accessToken
  });
  const create=await fetch(
    "https://graph.instagram.com/v25.0/"+encodeURIComponent(connection.provider_account_id)+"/media?"+params.toString(),
    {method:"POST",cache:"no-store"}
  );
  const created=await create.json();
  if(!create.ok||!created.id) throw new Error("Instagram 릴스 업로드 준비에 실패했습니다.");

  await updatePublish(eventId,{status:"processing",providerPostId:created.id,metadata:{containerId:created.id}});
  let ready=false;
  for(let i=0;i<10;i++){
    await new Promise(resolve=>setTimeout(resolve,1000));
    const statusUrl=new URL("https://graph.instagram.com/v25.0/"+encodeURIComponent(created.id));
    statusUrl.searchParams.set("fields","status_code,status");
    statusUrl.searchParams.set("access_token",connection.accessToken);
    const check=await fetch(statusUrl,{cache:"no-store"});
    const state=await check.json().catch(()=>({}));
    if(state.status_code==="FINISHED"){ready=true;break;}
    if(["ERROR","EXPIRED"].includes(state.status_code)) throw new Error("Instagram에서 영상 처리를 완료하지 못했습니다.");
  }
  if(!ready) throw new Error("Instagram 영상 처리가 아직 끝나지 않았습니다. 잠시 후 다시 시도해주세요.");

  const publishParams=new URLSearchParams({
    creation_id:created.id,
    access_token:connection.accessToken
  });
  const publish=await fetch(
    "https://graph.instagram.com/v25.0/"+encodeURIComponent(connection.provider_account_id)+"/media_publish?"+publishParams.toString(),
    {method:"POST",cache:"no-store"}
  );
  const data=await publish.json();
  if(!publish.ok||!data.id) throw new Error("Instagram 릴스 게시에 실패했습니다.");
  await updatePublish(eventId,{status:"published",providerPostId:data.id,metadata:{containerId:created.id}});
  return {
    status:"published",
    message:"Instagram 릴스 게시가 완료되었습니다.",
    postId:data.id,
    note:"Instagram 비즈니스/크리에이터 계정에 게시되었습니다."
  };
}

async function publishTiktok(userId,clipId,eventId){
  const connection=await refreshConnectionIfNeeded(userId,"tiktok");
  const {file}=await getClipSource(userId,clipId);
  const buffer=Buffer.from(await file.arrayBuffer());
  const size=buffer.length;
  if(!size) throw new Error("TikTok에 보낼 영상 파일이 비어 있습니다.");

  const maxChunk=16*1024*1024;
  const chunkSize=size<5*1024*1024?size:Math.min(maxChunk,size);
  const totalChunks=size<=chunkSize?1:Math.max(1,Math.floor(size/chunkSize));

  const init=await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",{
    method:"POST",
    headers:{
      Authorization:"Bearer "+connection.accessToken,
      "Content-Type":"application/json; charset=UTF-8"
    },
    body:JSON.stringify({
      source_info:{
        source:"FILE_UPLOAD",
        video_size:size,
        chunk_size:chunkSize,
        total_chunk_count:totalChunks
      }
    }),
    cache:"no-store"
  });
  const initialized=await init.json();
  const uploadUrl=initialized?.data?.upload_url;
  const publishId=initialized?.data?.publish_id;
  if(!init.ok||initialized?.error?.code!=="ok"||!uploadUrl||!publishId){
    throw new Error(initialized?.error?.message||"TikTok 전송 준비에 실패했습니다.");
  }

  await updatePublish(eventId,{status:"uploading",providerPostId:publishId,metadata:{publishId,mode:"inbox"}});
  let offset=0;
  for(let index=0;index<totalChunks;index++){
    const isLast=index===totalChunks-1;
    const end=isLast?size:Math.min(size,offset+chunkSize);
    const chunk=buffer.subarray(offset,end);
    const upload=await fetch(uploadUrl,{
      method:"PUT",
      headers:{
        "Content-Type":file.headers.get("content-type")||"video/mp4",
        "Content-Length":String(chunk.length),
        "Content-Range":"bytes "+offset+"-"+(end-1)+"/"+size
      },
      body:chunk
    });
    if(!upload.ok && upload.status!==206 && upload.status!==201){
      throw new Error("TikTok 영상 전송 중 오류가 발생했습니다.");
    }
    offset=end;
  }

  await updatePublish(eventId,{status:"processing",providerPostId:publishId,metadata:{publishId,mode:"inbox"}});
  return {
    status:"processing",
    message:"TikTok으로 영상 전송을 완료했습니다.",
    postId:publishId,
    note:"TikTok 앱 알림에서 영상을 열어 제목·공개 범위를 확인한 뒤 게시하면 됩니다."
  };
}

export async function POST(request){
  let event=null;
  try{
    const user=await requireUser(request);
    const body=await request.json();
    const provider=String(body.provider||"");
    const clipId=String(body.clipId||"");
    if(!["youtube","instagram","tiktok"].includes(provider)) return NextResponse.json({message:"지원하지 않는 채널입니다."},{status:400});
    if(!clipId) return NextResponse.json({message:"업로드할 완성 영상을 선택해주세요."},{status:400});

    event=await logPublish(user.id,provider,clipId,{
      status:"queued",
      title:cleanText(body.title||"",200)
    });

    let result;
    if(provider==="youtube") result=await publishYoutube(user.id,clipId,body,event?.id);
    if(provider==="instagram") result=await publishInstagram(user.id,clipId,body,event?.id);
    if(provider==="tiktok") result=await publishTiktok(user.id,clipId,event?.id);
    return NextResponse.json(result);
  }catch(error){
    if(event?.id) await updatePublish(event.id,{status:"failed",errorMessage:error?.message||"게시 실패"});
    return NextResponse.json({message:error?.message||"채널 게시에 실패했습니다."},{status:400});
  }
}
