import {adminRest,isAdminUser} from './paymentServer';
import {WEARON_PLANS} from './plans';

export async function balanceContext(userId) {
  const [subRes,admin,packRes]=await Promise.all([
    adminRest(`subscriptions?user_id=eq.${userId}&select=*&order=created_at.desc&limit=1`),
    isAdminUser(userId),
    adminRest(`credit_packs?user_id=eq.${userId}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&credits_remaining=gt.0&select=id,pack_id,credits_remaining,expires_at&order=expires_at.asc`)
  ]);
  if(!subRes.ok)throw new Error('이용권을 확인하지 못했습니다.');
  if(!packRes.ok)throw new Error('추가 크레딧을 확인하지 못했습니다.');

  const sub=(await subRes.json())[0];
  const active=sub?.status==='active'&&(!sub.current_period_end||new Date(sub.current_period_end)>new Date());
  const plan=WEARON_PLANS[active?sub.plan:'free']||WEARON_PLANS.free;

  let period='1970-01-01T00:00:00Z';
  if(active&&sub.current_period_end){
    const date=new Date(sub.current_period_end);
    date.setUTCMonth(date.getUTCMonth()-1);
    period=date.toISOString();
  }

  const usage=await adminRest(`usage_events?user_id=eq.${userId}&created_at=gte.${encodeURIComponent(period)}&select=event_type,units`);
  if(!usage.ok)throw new Error('크레딧을 확인하지 못했습니다.');

  const used=(await usage.json()).reduce((n,e)=>n+(e.event_type==='shorts_refund'?-e.units:e.units),0);
  const planBalance=Math.max(0,plan.credits-used);
  const packs=await packRes.json();
  const packBalance=(packs||[]).reduce((sum,p)=>sum+Number(p.credits_remaining||0),0);

  return {
    allowance:plan.credits,
    period,
    admin,
    plan:plan.id,
    planBalance,
    packBalance,
    packs:packs||[],
    balance:admin?999999:planBalance+packBalance
  };
}

export async function reserveCredits(userId,id,quote) {
  if(!/^[0-9a-f-]{36}$/i.test(id||''))throw new Error('요청 번호를 확인해주세요.');
  const ctx=await balanceContext(userId);
  const res=await adminRest('rpc/reserve_short_credits',{
    method:'POST',
    body:JSON.stringify({
      p_user:userId,
      p_id:id,
      p_quote:quote,
      p_allowance:ctx.allowance,
      p_period:ctx.period,
      p_admin:ctx.admin
    })
  });
  const data=await res.json();
  if(!res.ok)throw new Error(data.message||'크레딧 차감 실패');
  return data;
}

export async function settleCredits(id,count,failed=false){
  const res=await adminRest('rpc/settle_short_credits',{
    method:'POST',
    body:JSON.stringify({p_id:id,p_count:count,p_failed:failed})
  });
  if(!res.ok)throw new Error('크레딧 정산에 실패했습니다.');
  return res.json();
}

export async function updateGeneration(id,data){
  const res=await adminRest(`generation_requests?id=eq.${id}`,{method:'PATCH',body:JSON.stringify(data)});
  if(!res.ok)throw new Error('작업 상태 저장에 실패했습니다.');
}

export async function getGeneration(jobId,userId){
  const res=await adminRest(`generation_requests?provider_id=eq.${encodeURIComponent(jobId)}&user_id=eq.${userId}&select=*&limit=1`);
  if(!res.ok)throw new Error('작업 기록을 불러오지 못했습니다.');
  return (await res.json())[0];
}
