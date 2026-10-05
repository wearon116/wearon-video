export const ANALYSIS_CREDITS_PER_MINUTE = 1;
export const COMMENT_TEMPLATE_EXTRA_CREDITS = 2;
export const OUTPUT_SIZES = { '9:16':[1080,1920], '4:5':[1080,1350], '1:1':[1080,1080], '5:4':[1350,1080], '16:9':[1920,1080] };
export function creditQuote({start,end,template='댓글형',clipCount=6}) {
  start=Number(start);end=Number(end);clipCount=Number(clipCount);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||!Number.isInteger(clipCount)||clipCount<1||clipCount>6) throw new Error('분석 구간을 확인해주세요.');
  const seconds=end-start,base=Math.ceil(seconds/60)*ANALYSIS_CREDITS_PER_MINUTE;
  const extra=template==='댓글형'?clipCount*COMMENT_TEMPLATE_EXTRA_CREDITS:0;
  return {start,end,seconds,clipCount,base,extra,total:base+extra,template};
}
export function selectRelevantComments(comments,clip) {
  const terms=new Set(String((clip.title||clip.hook||'')+' '+(clip.transcript||'')).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]);
  return (comments||[]).filter(c=>c&&typeof c==='object'&&c.text).map((c,i)=>({c,i,score:[...terms].reduce((sum,t)=>sum+(c.text.toLowerCase().includes(t)?10:0),0)+Math.log1p(Number(c.likeCount)||0)})).sort((a,b)=>b.score-a.score||a.i-b.i).slice(0,3).map(x=>x.c);
}
