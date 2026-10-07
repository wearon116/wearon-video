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
export function selectRelevantComments(comments,clip={}) {
  const terms=new Set(String((clip.title||clip.hook||'')+' '+(clip.transcript||'')).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]);
  const duration=Math.max(8,Number(clip.duration)||24);
  const targetCount=Math.max(2,Math.min(8,Math.ceil(Math.max(8,duration-1)/7)));
  const humor=/ㅋㅋ|ㅎㅎ|😂|🤣|lol|웃기|개웃|레전드|미쳤|드립|실화|터졌|빵터|존웃/i;
  const ranked=(comments||[])
    .filter(c=>c&&typeof c==='object'&&String(c.text||'').trim())
    .map((c,i)=>{
      const text=String(c.text||'').replace(/\s+/g,' ').trim();
      const lower=text.toLowerCase();
      const relevance=[...terms].reduce((sum,t)=>sum+(lower.includes(t)?10:0),0);
      const engagement=Math.log1p(Math.max(0,Number(c.likeCount)||0))*2;
      const humorBonus=humor.test(text)?7:0;
      return {c:{...c,text},i,score:relevance+engagement+humorBonus};
    })
    .sort((a,b)=>b.score-a.score||a.i-b.i);
  const selected=[];
  const seenText=new Set();
  const seenAuthor=new Set();
  for(const item of ranked){
    const textKey=item.c.text.toLowerCase().replace(/\s+/g,' ').trim();
    const authorKey=String(item.c.author||'').toLowerCase().trim();
    if(seenText.has(textKey)) continue;
    if(authorKey&&seenAuthor.has(authorKey)) continue;
    seenText.add(textKey);
    if(authorKey) seenAuthor.add(authorKey);
    selected.push(item.c);
    if(selected.length>=targetCount) break;
  }
  return selected;
}
