import { NextResponse } from "next/server";
import { callbackUrl, createOAuthState, providerConfigured, providerEnvNames, requireUser } from "../../../../../lib/channelServer";

export const dynamic="force-dynamic";

export async function POST(request){
  try{
    const user=await requireUser(request);
    const {provider}=await request.json();
    if(!["youtube","instagram","tiktok"].includes(provider)) return NextResponse.json({message:"지원하지 않는 채널입니다."},{status:400});
    if(!providerConfigured(provider)){
      return NextResponse.json({
        message:"채널 앱 설정이 아직 필요합니다.",
        configured:false,
        missing:providerEnvNames(provider)
      },{status:409});
    }

    const state=createOAuthState(user.id,provider);
    const redirectUri=callbackUrl(provider);
    let url="";

    if(provider==="youtube"){
      const params=new URLSearchParams({
        client_id:process.env.GOOGLE_OAUTH_CLIENT_ID,
        redirect_uri:redirectUri,
        response_type:"code",
        access_type:"offline",
        prompt:"consent",
        scope:[
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly"
        ].join(" "),
        state
      });
      url="https://accounts.google.com/o/oauth2/v2/auth?"+params.toString();
    }

    if(provider==="instagram"){
      const params=new URLSearchParams({
        client_id:process.env.INSTAGRAM_APP_ID,
        redirect_uri:redirectUri,
        response_type:"code",
        scope:"instagram_business_basic,instagram_business_content_publish",
        enable_fb_login:"0",
        force_authentication:"1",
        state
      });
      url="https://www.instagram.com/oauth/authorize?"+params.toString();
    }

    if(provider==="tiktok"){
      const params=new URLSearchParams({
        client_key:process.env.TIKTOK_CLIENT_KEY,
        redirect_uri:redirectUri,
        response_type:"code",
        scope:"user.info.basic,video.upload",
        state
      });
      url="https://www.tiktok.com/v2/auth/authorize/?"+params.toString();
    }

    return NextResponse.json({url,configured:true});
  }catch(error){
    return NextResponse.json({message:error?.message||"채널 연동을 시작하지 못했습니다."},{status:400});
  }
}
