import { NextResponse } from "next/server";
import { adminRest } from "../../../../lib/paymentServer";
import { getPublishableClips, providerConfigured, requireUser } from "../../../../lib/channelServer";

export const dynamic="force-dynamic";

export async function GET(request){
  try{
    const user=await requireUser(request);
    const res=await adminRest(
      "channel_connections?user_id=eq."+encodeURIComponent(user.id)+"&select=provider,provider_account_id,provider_account_name,provider_avatar_url,token_expires_at,scopes,metadata,updated_at"
    );
    if(!res.ok) throw new Error("채널 연결 상태를 불러오지 못했습니다.");
    const rows=await res.json();
    const map={};
    for(const row of rows||[]) map[row.provider]={
      connected:true,
      accountId:row.provider_account_id||"",
      accountName:row.provider_account_name||"",
      avatarUrl:row.provider_avatar_url||"",
      expiresAt:row.token_expires_at||null,
      scopes:row.scopes||[],
      updatedAt:row.updated_at||null
    };
    const clips=await getPublishableClips(user.id);
    return NextResponse.json({
      providers:{
        youtube:{configured:providerConfigured("youtube"),connected:false,...map.youtube},
        instagram:{configured:providerConfigured("instagram"),connected:false,...map.instagram},
        tiktok:{configured:providerConfigured("tiktok"),connected:false,...map.tiktok}
      },
      clips,
      guide:{
        youtube:"연동하면 완성된 쇼츠를 YouTube에 바로 업로드할 수 있습니다.",
        instagram:"Instagram 비즈니스/크리에이터 계정은 완성본을 릴스로 게시할 수 있습니다.",
        tiktok:"TikTok 연동 후 완성본을 TikTok 초안으로 전송해 앱에서 마지막 확인 후 게시할 수 있습니다."
      }
    });
  }catch(error){
    return NextResponse.json({message:error?.message||"채널 정보를 불러오지 못했습니다."},{status:401});
  }
}
