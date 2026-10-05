export const dynamic = "force-dynamic";

const CATEGORY_IDS = {
  gaming: new Set(["20"]),
  entertainment: new Set(["23","24"]),
  info: new Set(["22","26","27","28"]),
  sports: new Set(["17"])
};

const CATEGORY_QUERIES = {
  all: "예능|코미디|웃긴|게임|리뷰|정보|스포츠|반응|챌린지",
  gaming: "게임|롤|리그오브레전드|발로란트|메이플|배그",
  entertainment: "예능|코미디|웃긴|몰카|반응|토크|챌린지",
  info: "리뷰|정보|꿀팁|테크|제품|상식",
  sports: "축구|야구|농구|스포츠",
  shorts: "쇼츠|shorts|웃긴|게임|정보"
};

function durationSeconds(iso=""){
  const m=String(iso||"").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if(!m) return 0;
  return Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0);
}

function isMusicVideo(v){
  const category=String(v?.snippet?.categoryId||"");
  const title=String(v?.snippet?.title||"");
  const channel=String(v?.snippet?.channelTitle||"");
  if(category==="10") return true;
  if(/\s-\sTopic$/i.test(channel)) return true;
  return /(official\s*(music\s*)?(video|audio)|\bofficial\s*mv\b|\bm\/v\b|\bmv\b|lyrics?|가사\s*(영상)?|음원|full\s*album|audio\s*only)/i.test(title);
}

function matchesCategory(v,category){
  if(!category || category==="all") return true;
  if(category==="shorts") return durationSeconds(v?.contentDetails?.duration||"")<=180;
  const ids=CATEGORY_IDS[category];
  return !ids || ids.has(String(v?.snippet?.categoryId||""));
}

function hasKorean(v){
  return /[가-힣]/.test(String(v?.snippet?.title||"")+" "+String(v?.snippet?.channelTitle||""));
}

function ageHours(publishedAt){
  const time=new Date(publishedAt||0).getTime();
  if(!Number.isFinite(time)||time<=0) return 99999;
  return Math.max(1,(Date.now()-time)/36e5);
}

function shape(v){
  const views=Number(v?.statistics?.viewCount||0);
  const hours=ageHours(v?.snippet?.publishedAt);
  const category=String(v?.snippet?.categoryId||"");
  const categoryBoost=category==="23"?1.35:category==="24"?1.28:category==="20"?1.24:category==="26"?1.14:category==="17"?1.08:1;
  const shortBoost=durationSeconds(v?.contentDetails?.duration||"")<=180?1.08:1;
  return {
    id:v.id,
    title:v?.snippet?.title||"",
    channelTitle:v?.snippet?.channelTitle||"",
    categoryId:category,
    thumbnail:
      v?.snippet?.thumbnails?.maxres?.url ||
      v?.snippet?.thumbnails?.high?.url ||
      v?.snippet?.thumbnails?.medium?.url ||
      v?.snippet?.thumbnails?.default?.url || "",
    publishedAt:v?.snippet?.publishedAt||"",
    viewCount:views,
    likeCount:Number(v?.statistics?.likeCount||0),
    duration:v?.contentDetails?.duration||"",
    license:String(v?.status?.license||"youtube"),
    reusable:String(v?.status?.license||"")==="creativeCommon",
    trendScore:(views/Math.pow(hours,.72))*categoryBoost*shortBoost,
    korean:hasKorean(v),
    url:`https://www.youtube.com/watch?v=${v.id}`
  };
}

async function fetchVideoDetails(ids,key){
  if(!ids.length) return [];
  const params=new URLSearchParams({
    part:"snippet,statistics,contentDetails,status",
    id:ids.join(","),
    key
  });
  const res=await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`,{
    next:{revalidate:300}
  });
  if(!res.ok) return [];
  return (await res.json()).items||[];
}

async function searchVideos({key,region,maxResults,query,category,reuseOnly,sort}){
  const q=String(query||"").trim() || CATEGORY_QUERIES[category] || CATEGORY_QUERIES.all;
  const publishedAfter=new Date(Date.now()-(query?365:120)*864e5).toISOString();
  const params=new URLSearchParams({
    part:"snippet",
    type:"video",
    maxResults:String(Math.min(50,Math.max(maxResults*2,24))),
    regionCode:region,
    relevanceLanguage:"ko",
    safeSearch:"moderate",
    order:sort==="views"?"viewCount":"relevance",
    publishedAfter,
    q,
    key
  });
  if(reuseOnly) params.set("videoLicense","creativeCommon");
  const singleId={
    gaming:"20",
    sports:"17",
    entertainment:"24",
    info:"26"
  }[category];
  if(singleId) params.set("videoCategoryId",singleId);

  const res=await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`,{
    next:{revalidate:300}
  });
  if(!res.ok){
    const detail=await res.text();
    return {error:{status:res.status,detail},items:[]};
  }
  const data=await res.json();
  const ids=(data.items||[]).map(x=>x?.id?.videoId).filter(Boolean);
  return {items:await fetchVideoDetails(ids,key)};
}

async function popularVideos({key,region}){
  const params=new URLSearchParams({
    part:"snippet,statistics,contentDetails,status",
    chart:"mostPopular",
    regionCode:region,
    maxResults:"50",
    key
  });
  const res=await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`,{
    next:{revalidate:300}
  });
  if(!res.ok){
    const detail=await res.text();
    return {error:{status:res.status,detail},items:[]};
  }
  return {items:(await res.json()).items||[]};
}

export async function GET(request) {
  const {searchParams}=new URL(request.url);
  const region=(searchParams.get("region")||"KR").toUpperCase();
  const maxResults=Math.min(Math.max(Number(searchParams.get("maxResults")||24),8),36);
  const category=String(searchParams.get("category")||"all");
  const sort=searchParams.get("sort")==="views"?"views":"rising";
  const reuseOnly=searchParams.get("reuse")==="1";
  const koreanFirst=searchParams.get("korean")!=="0";
  const query=String(searchParams.get("q")||"").trim().slice(0,80);
  const key=process.env.YOUTUBE_API_KEY;

  if(!key){
    return Response.json(
      {error:"YOUTUBE_API_KEY_MISSING",message:"YouTube API 키가 아직 연결되지 않았습니다."},
      {status:503}
    );
  }

  const useSearch=reuseOnly || Boolean(query);
  const result=useSearch
    ? await searchVideos({key,region,maxResults,query,category,reuseOnly,sort})
    : await popularVideos({key,region});

  if(result.error){
    return Response.json(
      {error:"YOUTUBE_API_ERROR",detail:result.error.detail},
      {status:result.error.status}
    );
  }

  let items=(result.items||[])
    .filter(v=>!isMusicVideo(v))
    .filter(v=>matchesCategory(v,category))
    .map(shape);

  if(reuseOnly) items=items.filter(v=>v.reusable);

  items.sort((a,b)=>{
    if(koreanFirst && a.korean!==b.korean) return a.korean?-1:1;
    if(sort==="views") return b.viewCount-a.viewCount;
    return b.trendScore-a.trendScore;
  });

  items=items.slice(0,maxResults).map((v,index)=>({...v,rank:index+1}));

  return Response.json({
    region,
    updatedAt:new Date().toISOString(),
    sort,
    category,
    reuseOnly,
    koreanFirst,
    query,
    source:useSearch?"search":"mostPopular",
    items
  });
}
