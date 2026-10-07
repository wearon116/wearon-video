import crypto from "crypto";
import { adminRest, requireUser } from "./paymentServer";

const PROVIDERS=["youtube","instagram","tiktok"];

function env(name){
  const value=process.env[name];
  if(!value) throw new Error(name+" 환경 변수가 없습니다.");
  return value;
}

export function providerConfigured(provider){
  if(provider==="youtube") return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID&&process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  if(provider==="instagram") return Boolean(process.env.INSTAGRAM_APP_ID&&process.env.INSTAGRAM_APP_SECRET);
  if(provider==="tiktok") return Boolean(process.env.TIKTOK_CLIENT_KEY&&process.env.TIKTOK_CLIENT_SECRET);
  return false;
}

export function providerEnvNames(provider){
  if(provider==="youtube") return ["GOOGLE_OAUTH_CLIENT_ID","GOOGLE_OAUTH_CLIENT_SECRET"];
  if(provider==="instagram") return ["INSTAGRAM_APP_ID","INSTAGRAM_APP_SECRET"];
  if(provider==="tiktok") return ["TIKTOK_CLIENT_KEY","TIKTOK_CLIENT_SECRET"];
  return [];
}

function secretKey(){
  return crypto.createHash("sha256").update(env("SUPABASE_SECRET_KEY")+":wearon-channel-token-v1").digest();
}

export function encryptToken(value=""){
  if(!value) return "";
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv("aes-256-gcm",secretKey(),iv);
  const body=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]);
  const tag=cipher.getAuthTag();
  return ["v1",iv.toString("base64url"),tag.toString("base64url"),body.toString("base64url")].join(".");
}

export function decryptToken(value=""){
  if(!value) return "";
  const [version,ivRaw,tagRaw,bodyRaw]=String(value).split(".");
  if(version!=="v1") throw new Error("저장된 채널 인증 정보를 읽을 수 없습니다.");
  const decipher=crypto.createDecipheriv("aes-256-gcm",secretKey(),Buffer.from(ivRaw,"base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(bodyRaw,"base64url")),decipher.final()]).toString("utf8");
}

function stateSecret(){
  return crypto.createHash("sha256").update(env("SUPABASE_SECRET_KEY")+":wearon-channel-oauth-state-v1").digest();
}

export function createOAuthState(userId,provider){
  const payload=Buffer.from(JSON.stringify({
    uid:userId,
    provider,
    exp:Date.now()+10*60*1000,
    nonce:crypto.randomBytes(12).toString("hex")
  })).toString("base64url");
  const sig=crypto.createHmac("sha256",stateSecret()).update(payload).digest("base64url");
  return payload+"."+sig;
}

export function verifyOAuthState(raw,provider){
  const [payload,sig]=String(raw||"").split(".");
  if(!payload||!sig) throw new Error("연동 요청이 만료되었거나 올바르지 않습니다.");
  const expected=crypto.createHmac("sha256",stateSecret()).update(payload).digest("base64url");
  const a=Buffer.from(sig), b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) throw new Error("채널 연동 보안 확인에 실패했습니다.");
  const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
  if(data.provider!==provider||Number(data.exp)<Date.now()) throw new Error("채널 연동 요청이 만료되었습니다.");
  return data;
}

export function siteBase(){
  return (process.env.CHANNEL_REDIRECT_BASE_URL||process.env.NEXT_PUBLIC_SITE_URL||"https://wearonvideo.store").replace(/\/$/,"");
}

export function callbackUrl(provider){
  return siteBase()+"/api/channels/oauth/callback/"+provider;
}

export async function saveConnection(userId,provider,data){
  if(!PROVIDERS.includes(provider)) throw new Error("지원하지 않는 채널입니다.");
  const body={
    user_id:userId,
    provider,
    provider_account_id:String(data.accountId||""),
    provider_account_name:String(data.accountName||""),
    provider_avatar_url:String(data.avatarUrl||""),
    access_token:encryptToken(data.accessToken),
    refresh_token:encryptToken(data.refreshToken||""),
    token_expires_at:data.expiresAt||null,
    scopes:Array.isArray(data.scopes)?data.scopes:[],
    metadata:data.metadata||{},
    updated_at:new Date().toISOString()
  };
  const res=await adminRest("channel_connections?on_conflict=user_id,provider",{
    method:"POST",
    headers:{"Prefer":"resolution=merge-duplicates,return=representation"},
    body:JSON.stringify(body)
  });
  if(!res.ok) throw new Error("채널 연결 정보를 저장하지 못했습니다.");
  return (await res.json())[0];
}

export async function getConnection(userId,provider){
  const res=await adminRest(
    "channel_connections?user_id=eq."+encodeURIComponent(userId)+"&provider=eq."+encodeURIComponent(provider)+"&select=*&limit=1"
  );
  if(!res.ok) throw new Error("채널 연결 정보를 불러오지 못했습니다.");
  const row=(await res.json())[0];
  if(!row) return null;
  return {
    ...row,
    accessToken:decryptToken(row.access_token),
    refreshToken:decryptToken(row.refresh_token||"")
  };
}

export async function deleteConnection(userId,provider){
  const res=await adminRest(
    "channel_connections?user_id=eq."+encodeURIComponent(userId)+"&provider=eq."+encodeURIComponent(provider),
    {method:"DELETE"}
  );
  if(!res.ok) throw new Error("채널 연결 해제에 실패했습니다.");
}

export async function refreshConnectionIfNeeded(userId,provider){
  const row=await getConnection(userId,provider);
  if(!row) throw new Error("먼저 채널을 연동해주세요.");
  const expires=row.token_expires_at?new Date(row.token_expires_at).getTime():0;
  if(!expires||expires>Date.now()+5*60*1000) return row;

  if(provider==="youtube"&&row.refreshToken){
    const body=new URLSearchParams({
      client_id:env("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret:env("GOOGLE_OAUTH_CLIENT_SECRET"),
      grant_type:"refresh_token",
      refresh_token:row.refreshToken
    });
    const res=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body,cache:"no-store"});
    const data=await res.json();
    if(!res.ok) throw new Error("YouTube 인증 갱신에 실패했습니다.");
    await saveConnection(userId,provider,{
      accountId:row.provider_account_id,
      accountName:row.provider_account_name,
      avatarUrl:row.provider_avatar_url,
      accessToken:data.access_token,
      refreshToken:row.refreshToken,
      expiresAt:new Date(Date.now()+Number(data.expires_in||3600)*1000).toISOString(),
      scopes:row.scopes,
      metadata:row.metadata
    });
    return getConnection(userId,provider);
  }

  if(provider==="tiktok"&&row.refreshToken){
    const body=new URLSearchParams({
      client_key:env("TIKTOK_CLIENT_KEY"),
      client_secret:env("TIKTOK_CLIENT_SECRET"),
      grant_type:"refresh_token",
      refresh_token:row.refreshToken
    });
    const res=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body,cache:"no-store"});
    const data=await res.json();
    if(!res.ok||!data.access_token) throw new Error("TikTok 인증 갱신에 실패했습니다.");
    await saveConnection(userId,provider,{
      accountId:data.open_id||row.provider_account_id,
      accountName:row.provider_account_name,
      avatarUrl:row.provider_avatar_url,
      accessToken:data.access_token,
      refreshToken:data.refresh_token||row.refreshToken,
      expiresAt:new Date(Date.now()+Number(data.expires_in||86400)*1000).toISOString(),
      scopes:String(data.scope||"").split(",").filter(Boolean),
      metadata:row.metadata
    });
    return getConnection(userId,provider);
  }

  if(provider==="instagram"){
    const res=await fetch(
      "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token="+encodeURIComponent(row.accessToken),
      {cache:"no-store"}
    );
    const data=await res.json();
    if(!res.ok||!data.access_token) throw new Error("Instagram 인증 갱신에 실패했습니다.");
    await saveConnection(userId,provider,{
      accountId:row.provider_account_id,
      accountName:row.provider_account_name,
      avatarUrl:row.provider_avatar_url,
      accessToken:data.access_token,
      refreshToken:"",
      expiresAt:new Date(Date.now()+Number(data.expires_in||5184000)*1000).toISOString(),
      scopes:row.scopes,
      metadata:row.metadata
    });
    return getConnection(userId,provider);
  }

  throw new Error("채널 인증이 만료되었습니다. 다시 연동해주세요.");
}

export async function getPublishableClips(userId){
  const [clipRes,projectRes]=await Promise.all([
    adminRest(
      "clips?user_id=eq."+encodeURIComponent(userId)+"&status=eq.completed&select=id,title,project_id,caption_style,transcript,created_at&order=created_at.desc&limit=100"
    ),
    adminRest(
      "projects?user_id=eq."+encodeURIComponent(userId)+"&select=id,title,status,created_at&order=created_at.desc&limit=100"
    )
  ]);
  if(!clipRes.ok||!projectRes.ok) return [];

  const clips=(await clipRes.json()||[]).filter(row=>row?.caption_style?.outputStoragePath);
  const projects=await projectRes.json()||[];
  const projectMap=new Map(projects.map(project=>[project.id,project]));

  return clips.map(row=>{
    const project=projectMap.get(row.project_id);
    return {
      id:row.id,
      title:row.title||"완성 쇼츠",
      projectId:row.project_id,
      projectTitle:project?.title||"기타 프로젝트",
      transcript:String(row.transcript||"").slice(0,700),
      createdAt:row.created_at
    };
  });
}

export async function getClipSource(userId,clipId){
  const res=await adminRest(
    "clips?id=eq."+encodeURIComponent(clipId)+"&user_id=eq."+encodeURIComponent(userId)+"&select=id,title,caption_style,status&limit=1"
  );
  if(!res.ok) throw new Error("업로드할 영상을 불러오지 못했습니다.");
  const clip=(await res.json())[0];
  const path=clip?.caption_style?.outputStoragePath;
  if(!clip||clip.status!=="completed"||!path) throw new Error("먼저 완성본 MP4를 저장해주세요.");

  const url=env("NEXT_PUBLIC_SUPABASE_URL");
  const secret=env("SUPABASE_SECRET_KEY");
  const encoded=String(path).split("/").map(encodeURIComponent).join("/");
  const file=await fetch(url+"/storage/v1/object/rendered-videos/"+encoded,{
    headers:{apikey:secret,Authorization:"Bearer "+secret},
    cache:"no-store"
  });
  if(!file.ok) throw new Error("저장된 완성본 MP4를 불러오지 못했습니다.");
  return {clip,file,path,title:clip.title||"WEARON VIDEO 쇼츠"};
}

export async function createSignedClipUrl(path,expiresIn=3600){
  const url=env("NEXT_PUBLIC_SUPABASE_URL");
  const secret=env("SUPABASE_SECRET_KEY");
  const encoded=String(path).split("/").map(encodeURIComponent).join("/");
  const res=await fetch(url+"/storage/v1/object/sign/rendered-videos/"+encoded,{
    method:"POST",
    headers:{apikey:secret,Authorization:"Bearer "+secret,"Content-Type":"application/json"},
    body:JSON.stringify({expiresIn}),
    cache:"no-store"
  });
  const data=await res.json();
  if(!res.ok||!data.signedURL) throw new Error("게시용 영상 링크를 만들지 못했습니다.");
  return data.signedURL.startsWith("http")?data.signedURL:url+data.signedURL;
}

export async function logPublish(userId,provider,clipId,data={}){
  const res=await adminRest("channel_publish_events",{
    method:"POST",
    headers:{"Prefer":"return=representation"},
    body:JSON.stringify({
      user_id:userId,
      provider,
      clip_id:clipId,
      status:data.status||"queued",
      provider_post_id:data.providerPostId||null,
      title:data.title||null,
      error_message:data.errorMessage||null,
      metadata:data.metadata||{}
    })
  });
  if(!res.ok) return null;
  return (await res.json())[0];
}

export async function updatePublish(id,data={}){
  if(!id) return;
  await adminRest("channel_publish_events?id=eq."+encodeURIComponent(id),{
    method:"PATCH",
    body:JSON.stringify({
      ...(data.status?{status:data.status}:{}),
      ...(data.providerPostId?{provider_post_id:data.providerPostId}:{}),
      ...(data.errorMessage!==undefined?{error_message:data.errorMessage}:{}),
      ...(data.metadata?{metadata:data.metadata}:{}),
      updated_at:new Date().toISOString()
    })
  });
}

export { requireUser };
