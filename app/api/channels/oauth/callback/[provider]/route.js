import { NextResponse } from "next/server";
import { callbackUrl, saveConnection, siteBase, verifyOAuthState } from "../../../../../../lib/channelServer";

export const dynamic="force-dynamic";

function redirectResult(provider,status,message=""){
  const url=new URL(siteBase());
  url.searchParams.set("open","channels");
  url.searchParams.set("provider",provider);
  url.searchParams.set("channel",status);
  if(message) url.searchParams.set("message",message.slice(0,180));
  return NextResponse.redirect(url);
}

async function connectYoutube(code,userId){
  const redirectUri=callbackUrl("youtube");
  const body=new URLSearchParams({
    client_id:process.env.GOOGLE_OAUTH_CLIENT_ID||"",
    client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET||"",
    code,
    grant_type:"authorization_code",
    redirect_uri:redirectUri
  });
  const tokenRes=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body,
    cache:"no-store"
  });
  const token=await tokenRes.json();
  if(!tokenRes.ok||!token.access_token) throw new Error("YouTube 인증 토큰을 받지 못했습니다.");

  const profileRes=await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",{
    headers:{Authorization:"Bearer "+token.access_token},
    cache:"no-store"
  });
  const profile=await profileRes.json();
  if(!profileRes.ok) throw new Error("YouTube 채널 정보를 불러오지 못했습니다.");
  const channel=profile.items?.[0];
  if(!channel?.id) throw new Error("업로드할 YouTube 채널을 찾지 못했습니다.");

  await saveConnection(userId,"youtube",{
    accountId:channel.id,
    accountName:channel.snippet?.title||"YouTube",
    avatarUrl:channel.snippet?.thumbnails?.default?.url||"",
    accessToken:token.access_token,
    refreshToken:token.refresh_token||"",
    expiresAt:new Date(Date.now()+Number(token.expires_in||3600)*1000).toISOString(),
    scopes:String(token.scope||"").split(" ").filter(Boolean),
    metadata:{channelDescription:channel.snippet?.description||""}
  });
}

async function connectInstagram(code,userId){
  const redirectUri=callbackUrl("instagram");
  const form=new URLSearchParams({
    client_id:process.env.INSTAGRAM_APP_ID||"",
    client_secret:process.env.INSTAGRAM_APP_SECRET||"",
    grant_type:"authorization_code",
    redirect_uri:redirectUri,
    code
  });
  const shortRes=await fetch("https://api.instagram.com/oauth/access_token",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:form,
    cache:"no-store"
  });
  const shortData=await shortRes.json();
  const shortToken=shortData?.access_token||shortData?.data?.[0]?.access_token;
  if(!shortRes.ok||!shortToken) throw new Error("Instagram 인증 토큰을 받지 못했습니다.");

  const longUrl=new URL("https://graph.instagram.com/access_token");
  longUrl.searchParams.set("grant_type","ig_exchange_token");
  longUrl.searchParams.set("client_secret",process.env.INSTAGRAM_APP_SECRET||"");
  longUrl.searchParams.set("access_token",shortToken);
  const longRes=await fetch(longUrl,{cache:"no-store"});
  const longData=await longRes.json();
  const accessToken=longRes.ok&&longData?.access_token?longData.access_token:shortToken;
  const expiresIn=Number(longData?.expires_in||3600);

  const profileUrl=new URL("https://graph.instagram.com/me");
  profileUrl.searchParams.set("fields","id,username,profile_picture_url");
  profileUrl.searchParams.set("access_token",accessToken);
  const profileRes=await fetch(profileUrl,{cache:"no-store"});
  const profile=await profileRes.json();
  if(!profileRes.ok||!profile?.id) throw new Error("Instagram 프로필 정보를 불러오지 못했습니다.");

  await saveConnection(userId,"instagram",{
    accountId:profile.id,
    accountName:profile.username||"Instagram",
    avatarUrl:profile.profile_picture_url||"",
    accessToken,
    expiresAt:new Date(Date.now()+expiresIn*1000).toISOString(),
    scopes:["instagram_business_basic","instagram_business_content_publish"],
    metadata:{professionalOnly:true}
  });
}

async function connectTiktok(code,userId){
  const redirectUri=callbackUrl("tiktok");
  const form=new URLSearchParams({
    client_key:process.env.TIKTOK_CLIENT_KEY||"",
    client_secret:process.env.TIKTOK_CLIENT_SECRET||"",
    code,
    grant_type:"authorization_code",
    redirect_uri:redirectUri
  });
  const tokenRes=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:form,
    cache:"no-store"
  });
  const token=await tokenRes.json();
  if(!tokenRes.ok||!token.access_token) throw new Error("TikTok 인증 토큰을 받지 못했습니다.");

  const profileRes=await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",{
    headers:{Authorization:"Bearer "+token.access_token},
    cache:"no-store"
  });
  const profileData=await profileRes.json();
  const profile=profileData?.data?.user||{};
  if(!profileRes.ok) throw new Error("TikTok 프로필 정보를 불러오지 못했습니다.");

  await saveConnection(userId,"tiktok",{
    accountId:token.open_id||profile.open_id||"",
    accountName:profile.display_name||"TikTok",
    avatarUrl:profile.avatar_url||"",
    accessToken:token.access_token,
    refreshToken:token.refresh_token||"",
    expiresAt:new Date(Date.now()+Number(token.expires_in||86400)*1000).toISOString(),
    scopes:String(token.scope||"").split(",").filter(Boolean),
    metadata:{uploadMode:"inbox"}
  });
}

export async function GET(request,{params}){
  const provider=String(params?.provider||"");
  if(!["youtube","instagram","tiktok"].includes(provider)) return redirectResult("unknown","error","지원하지 않는 채널입니다.");

  const url=new URL(request.url);
  const error=url.searchParams.get("error");
  if(error) return redirectResult(provider,"error",url.searchParams.get("error_description")||"사용자가 연동을 취소했습니다.");

  try{
    const code=url.searchParams.get("code");
    const state=url.searchParams.get("state");
    if(!code) throw new Error("인증 코드가 없습니다.");
    const verified=verifyOAuthState(state,provider);

    if(provider==="youtube") await connectYoutube(code,verified.uid);
    if(provider==="instagram") await connectInstagram(code,verified.uid);
    if(provider==="tiktok") await connectTiktok(code,verified.uid);

    return redirectResult(provider,"connected","채널 연동이 완료되었습니다.");
  }catch(error){
    return redirectResult(provider,"error",error?.message||"채널 연동에 실패했습니다.");
  }
}
