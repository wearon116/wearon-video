import { NextResponse } from "next/server";
import { deleteConnection, requireUser } from "../../../../lib/channelServer";

export const dynamic="force-dynamic";

export async function POST(request){
  try{
    const user=await requireUser(request);
    const {provider}=await request.json();
    if(!["youtube","instagram","tiktok"].includes(provider)) return NextResponse.json({message:"지원하지 않는 채널입니다."},{status:400});
    await deleteConnection(user.id,provider);
    return NextResponse.json({ok:true});
  }catch(error){
    return NextResponse.json({message:error?.message||"연동 해제에 실패했습니다."},{status:400});
  }
}
