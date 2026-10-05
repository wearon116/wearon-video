"use client";

// WEARON deploy sync marker: partial-results + 9x16/16x9 + comment-capture settings

import { useEffect, useRef, useState } from "react";
import {
  authenticatedFetch,
  consumeAuthRedirect,
  getCurrentUser,
  getSession,
  signIn,
  signOut,
  signUp,
  resendSignupConfirmation,
  verifyEmailOtp
} from "../lib/supabaseAuth";
import { creditQuote, OUTPUT_SIZES, selectRelevantComments } from "../lib/credits";
import { convertMp4 } from "../lib/mp4";
import { EARLY_BIRD_PACKS, WEARON_PLANS } from "../lib/plans";

const PENDING_YOUTUBE_JOB_KEY = "wearon_pending_youtube_job_v1";

const nav = [
  ["home","✦","새 프로젝트"],
  ["projects","▦","내 프로젝트"],
  ["templates","▣","템플릿"],
  ["popular","🔥","실시간 인기"],
  ["saved","♡","저장된 영상"],
  ["channels","⌁","채널 연동"],
  ["guide","?","숏폼 전략 가이드"]
];

const TREND_FILTERS = [
  ["all","전체"],
  ["shorts","쇼츠"],
  ["gaming","게임"],
  ["sports","스포츠"],
  ["music","음악"],
  ["entertainment","엔터"],
  ["news","뉴스"],
  ["lifestyle","라이프"]
];

function trendMatches(video,filter){
  if(filter==="all") return true;
  if(filter==="shorts") return durationToSeconds(video?.duration||"")<=60;
  const category=String(video?.categoryId||"");
  if(filter==="gaming") return category==="20";
  if(filter==="sports") return category==="17";
  if(filter==="music") return category==="10";
  if(filter==="entertainment") return ["1","23","24"].includes(category);
  if(filter==="news") return category==="25";
  if(filter==="lifestyle") return ["2","15","19","22","26","27","28"].includes(category);
  return true;
}

const templateData = [
  ["후킹 제목","상단 후킹 제목만 표시하는 기본형"],
  ["댓글형","원본 영상 + 실제 YouTube 댓글 카드 형식"],
  ["미니멀","원본 영상에 집중하는 깔끔한 레이아웃"],
  ["게임형","게임/스트리밍용 상단 후킹형"],
  ["인터뷰형","대화 흐름과 화자 구도를 살린 형식"],
  ["리뷰형","제품/서비스 포인트를 빠르게 요약"],
  ["브이로그형","감성 컷 + 후킹 제목 중심"],
  ["뉴스형","정보 전달을 우선한 선명한 구조"]
];

const strategyGuides = [
  {
    id:"01",
    tag:"VIRAL FORMULA",
    title:"조회수 터지는 숏폼 7가지 공식",
    desc:"첫 2초 후킹부터 완주율을 높이는 장면 배치까지, 바로 적용할 수 있는 핵심 공식입니다.",
    image:"https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=900&q=82"
  },
  {
    id:"02",
    tag:"HOOK",
    title:"첫 2초 후킹 제목 설계법",
    desc:"스크롤을 멈추게 만드는 제목 길이, 단어 선택, 화면 배치 원칙을 정리했습니다.",
    image:"https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=82"
  },
  {
    id:"03",
    tag:"MULTI PLATFORM",
    title:"유튜브·릴스·틱톡 동시 공략법",
    desc:"같은 원본을 플랫폼별 시청 흐름에 맞춰 재활용하는 업로드 전략을 담았습니다.",
    image:"https://images.unsplash.com/photo-1531297484001-80022131f5a1?auto=format&fit=crop&w=900&q=82"
  },
  {
    id:"04",
    tag:"ENGAGEMENT",
    title:"댓글이 붙는 쇼츠 구성 공식",
    desc:"시청자가 반응하고 댓글을 남기게 만드는 질문, 반전, 댓글 오버레이 배치법입니다.",
    image:"https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=900&q=82"
  },
  {
    id:"05",
    tag:"RIGHTS",
    title:"AI 쇼츠 저작권 생존 가이드",
    desc:"원본 영상 권리, 편집 허용 범위, 재사용 전 확인해야 할 체크리스트를 정리했습니다.",
    image:"https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=900&q=82"
  },
  {
    id:"06",
    tag:"GROWTH",
    title:"업로드 후 24시간 운영 체크리스트",
    desc:"제목 수정, 반응 확인, 재업로드 판단 등 게시 직후 해야 할 운영 순서를 정리했습니다.",
    image:"https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=82"
  }
];

function fmt(n=0){
  return new Intl.NumberFormat("ko-KR", { notation:"compact", maximumFractionDigits:1 }).format(n);
}
function durationToText(iso=""){
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if(!m) return "";
  const h=Number(m[1]||0), min=Number(m[2]||0), s=Number(m[3]||0);
  return h ? `${h}:${String(min).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${min}:${String(s).padStart(2,"0")}`;
}
function durationToSeconds(iso=""){
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if(!m) return 0;
  return Number(m[1]||0)*3600 + Number(m[2]||0)*60 + Number(m[3]||0);
}
function clock(total=0){
  const s=Math.max(0,Math.round(Number(total)||0));
  const h=Math.floor(s/3600);
  const m=Math.floor((s%3600)/60);
  const sec=s%60;
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}` : `${m}:${String(sec).padStart(2,"0")}`;
}

// Use media time so pause, seek, replay and exported frames stay in sync.
const COMMENT_INTERVAL_SECONDS = 4;
function activeCommentIndex(count, elapsedSeconds=0){
  if(!count) return -1;
  const seconds=Number.isFinite(elapsedSeconds)?Math.max(0,elapsedSeconds):0;
  return Math.floor(seconds/COMMENT_INTERVAL_SECONDS)%count;
}

export default function Home(){
  const [page,setPage] = useState("home");
  const [sourceMode,setSourceMode] = useState("youtube");
  const [url,setUrl] = useState("");
  const [ytMeta,setYtMeta] = useState(null);
  const [file,setFile] = useState(null);
  const [fileUrl,setFileUrl] = useState("");
  const [fileDuration,setFileDuration] = useState(0);
  const [sourceStoragePath,setSourceStoragePath] = useState("");
  const [builderOpen,setBuilderOpen] = useState(false);
  const [rangeStart,setRangeStart] = useState(0);
  const [rangeEnd,setRangeEnd] = useState(60);
  const [selectedTemplate,setSelectedTemplate] = useState("댓글형");
  const [aspectRatio,setAspectRatio] = useState("9:16");
  const [brandColor,setBrandColor] = useState("#7c5cff");
  const [hookLanguage,setHookLanguage] = useState("ko");
  const [rightsConfirmed,setRightsConfirmed] = useState(false);
  const [creditBalance,setCreditBalance] = useState(null);
  const [presetPreviews,setPresetPreviews] = useState({});
  const [editing,setEditing] = useState(null);
  const [renderTick,setRenderTick] = useState(0);
  const outputBusyRef=useRef(false);
  const outputUrlsRef=useRef(new Set());
  const requestIdRef=useRef(null);
  const [creditWarning,setCreditWarning] = useState("");
  const [trending,setTrending] = useState([]);
  const [trendStatus,setTrendStatus] = useState("loading");
  const [trendCategory,setTrendCategory] = useState("all");
  const [analysisTick,setAnalysisTick] = useState(Date.now());
  const [projects,setProjects] = useState([]);
  const [myTemplates,setMyTemplates] = useState([]);
  const [templateName,setTemplateName] = useState("");
  const [templateBusy,setTemplateBusy] = useState(false);
  const [templateDraftPreview,setTemplateDraftPreview] = useState("");
  const [openingProject,setOpeningProject] = useState(null);
  const [results,setResults] = useState([]);
  const [analysis,setAnalysis] = useState(0);
  const [analysisMsg,setAnalysisMsg] = useState("");
  const [preview,setPreview] = useState(null);
  const [previewElapsed,setPreviewElapsed] = useState(0);
  const [premium,setPremium] = useState(false);
  const [downloadPaywall,setDownloadPaywall] = useState(false);
  const [subscription,setSubscription] = useState({plan:"free",status:"active",current_period_end:null});
  const [checkoutPlan,setCheckoutPlan] = useState(null);
  const [checkoutOrder,setCheckoutOrder] = useState(null);
  const [checkoutBusy,setCheckoutBusy] = useState(false);
  const [toast,setToast] = useState("");
  const [rendering,setRendering] = useState(false);
  const [renderProgress,setRenderProgress] = useState(0);
  const [user,setUser] = useState(null);
  const [isAdmin,setIsAdmin] = useState(false);
  const [adminTestMode,setAdminTestMode] = useState(false);
  const [pendingYoutubeJob,setPendingYoutubeJob] = useState(null);
  const [authReady,setAuthReady] = useState(false);
  const [authModal,setAuthModal] = useState(false);
  const [authMode,setAuthMode] = useState("login");
  const [authEmail,setAuthEmail] = useState("");
  const [authPassword,setAuthPassword] = useState("");
  const [authName,setAuthName] = useState("");
  const [authCode,setAuthCode] = useState("");
  const [authStep,setAuthStep] = useState("form");
  const [authBusy,setAuthBusy] = useState(false);
  const fileInput = useRef(null);
  const pendingWatcherRef = useRef(false);

  const sourceSeconds=file?fileDuration:durationToSeconds(ytMeta?.duration||"");
  const checkoutProduct=checkoutPlan ? (WEARON_PLANS[checkoutPlan] || EARLY_BIRD_PACKS[checkoutPlan]) : null;
  const activePaidPlan=Boolean(
    subscription?.status==="active" &&
    subscription?.plan!=="free" &&
    (!subscription?.current_period_end || new Date(subscription.current_period_end)>new Date())
  );
  let quote=null;
  try{quote=creditQuote({start:rangeStart,end:rangeEnd,template:selectedTemplate,clipCount:file?3:Math.min(6,Math.max(1,Math.floor((rangeEnd-rangeStart)/20)))});}catch{}

  async function loadCreditBalance(){
    const session=await getSession();if(!session)return;
    const response=await fetch('/api/credits',{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'});
    if(response.ok)setCreditBalance(await response.json());
  }
  useEffect(()=>{if(user)void loadCreditBalance();else setCreditBalance(null);},[user]);
  useEffect(()=>{requestIdRef.current=null;},[url,file,rangeStart,rangeEnd,selectedTemplate,aspectRatio,brandColor]);
  useEffect(()=>()=>{outputUrlsRef.current.forEach(url=>URL.revokeObjectURL(url));},[]);

  useEffect(()=>{
    let mounted=true;

    (async()=>{
      try{
        await consumeAuthRedirect();
        const current=await getCurrentUser();
        if(!mounted) return;
        setUser(current);
        if(current) {
          await Promise.all([loadCloudProjects(),loadCloudTemplates(),loadSubscription(),loadAdminStatus()]);
        } else {
          setProjects([]);setMyTemplates([]);
          setIsAdmin(false);
          setAdminTestMode(false);
          setSubscription({plan:"free",status:"active",current_period_end:null});
        }
      }catch{
        if(mounted) setUser(null);
      }finally{
        if(mounted) setAuthReady(true);
      }
    })();

    loadTrending();
    const timer=setInterval(loadTrending, 5*60*1000);
    const sync=async()=>{
      const current=await getCurrentUser();
      if(!mounted) return;
      setUser(current);
      if(current) {
        await Promise.all([loadCloudProjects(),loadCloudTemplates(),loadSubscription(),loadAdminStatus()]);
      } else {
        setProjects([]);setMyTemplates([]);
        setIsAdmin(false);
        setSubscription({plan:"free",status:"active",current_period_end:null});
      }
    };
    window.addEventListener("wearon-auth-changed",sync);

    return ()=>{
      mounted=false;
      clearInterval(timer);
      window.removeEventListener("wearon-auth-changed",sync);
    };
  },[]);

  useEffect(()=>{
    if(!toast) return;
    const t=setTimeout(()=>setToast(""),2300);
    return ()=>clearTimeout(t);
  },[toast]);

  useEffect(()=>{
    if(page!=="analysis" || !pendingYoutubeJob) return;
    setAnalysisTick(Date.now());
    const t=setInterval(()=>setAnalysisTick(Date.now()),1000);
    return ()=>clearInterval(t);
  },[page,pendingYoutubeJob?.jobId]);

  useEffect(()=>{
    if(!authReady || !user || pendingWatcherRef.current) return;
    try{
      const raw=window.localStorage.getItem(PENDING_YOUTUBE_JOB_KEY);
      if(!raw) return;
      const job=JSON.parse(raw);
      if(!job?.jobId || !job?.accessToken) return;
      setPendingYoutubeJob(job);
      if(job?.meta) setYtMeta(job.meta);
      void watchYoutubeJob(job,{resume:true});
    }catch{}
  },[authReady,user]);



  async function loadSubscription(){
    try{
      const res=await authenticatedFetch("/rest/v1/subscriptions?select=plan,status,current_period_end&limit=1");
      if(!res.ok) throw new Error();
      const rows=await res.json();
      setSubscription(rows?.[0] || {plan:"free",status:"active",current_period_end:null});
    }catch{
      setSubscription({plan:"free",status:"active",current_period_end:null});
    }
  }


  async function openCheckout(planId){
    if(!user){
      setPremium(false);
      setAuthMode("login");
      setAuthStep("form");
      setAuthModal(true);
      return setToast("이용권을 신청하려면 먼저 로그인해주세요.");
    }
    if(subscription?.plan===planId && subscription?.status==="active"){
      return setToast("현재 이용 중인 요금제입니다.");
    }

    setCheckoutPlan(planId);
    setCheckoutOrder(null);
    setCheckoutBusy(true);
    setPremium(false);

    try{
      const session=await getSession();
      if(!session?.access_token) throw new Error("다시 로그인해주세요.");

      const orderRes=await fetch("/api/payments/create-order",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          Authorization:`Bearer ${session.access_token}`
        },
        body:JSON.stringify({plan:planId})
      });
      const order=await orderRes.json();
      if(!orderRes.ok) throw new Error(order.message||"입금 주문 생성에 실패했습니다.");
      setCheckoutOrder(order);
    }catch(err){
      setCheckoutPlan(null);
      setToast(err?.message||"계좌이체 신청을 준비하지 못했습니다.");
    }finally{
      setCheckoutBusy(false);
    }
  }

  async function copyBankAccount(){
    const text=checkoutOrder?.account||"";
    if(!text) return;
    try{
      await navigator.clipboard.writeText(text);
      setToast("계좌번호를 복사했습니다.");
    }catch{
      setToast("계좌번호를 길게 눌러 복사해주세요.");
    }
  }

  async function refreshBankTransferStatus(){
    if(!checkoutOrder?.orderId) return setToast("주문 정보를 확인할 수 없습니다.");

    try{
      const session=await getSession();
      if(!session?.access_token) throw new Error("다시 로그인해주세요.");

      const res=await fetch(`/api/payments/status?orderId=${encodeURIComponent(checkoutOrder.orderId)}`,{
        headers:{Authorization:`Bearer ${session.access_token}`},
        cache:"no-store"
      });
      const data=await res.json();
      if(!res.ok) throw new Error(data.message||"입금 상태를 확인하지 못했습니다.");

      if(data.status!=="paid"){
        return setToast("아직 입금 확인 대기 중입니다.");
      }

      if(data.productType==="credit_pack"){
        await loadCreditBalance();
        setCheckoutPlan(null);
        setCheckoutOrder(null);
        setToast("입금 확인이 완료되어 얼리버드 크레딧이 추가됐습니다.");
        return;
      }

      await loadSubscription();
      setCheckoutPlan(null);
      setCheckoutOrder(null);
      setToast("입금 확인이 완료되어 이용권이 활성화됐습니다.");
    }catch(error){
      setToast(error?.message||"입금 상태 확인 중 오류가 발생했습니다.");
    }
  }

  function currentDesign(){return {template:selectedTemplate,aspectRatio,brandColor};}

  async function loadCloudTemplates(){
    try{
      const response=await authenticatedFetch("/rest/v1/user_templates?select=*&order=created_at.desc");
      if(!response.ok) throw new Error();
      setMyTemplates(await response.json());
    }catch{setToast("내 템플릿을 불러오지 못했습니다. 다시 시도해주세요.");}
  }

  async function openCloudProject(project){
    if(openingProject) return;
    setOpeningProject(project.id);
    try{
      const response=await authenticatedFetch(`/rest/v1/projects?id=eq.${encodeURIComponent(project.id)}&select=*,clips(*)&clips.order=created_at.asc`);
      if(!response.ok) throw new Error("프로젝트를 불러오지 못했습니다.");
      const row=(await response.json())[0];
      if(!row) throw new Error("프로젝트를 찾을 수 없습니다.");
      let source="";
      if(row.source_url?.startsWith("storage://source-videos/")){
        const path=row.source_url.slice("storage://source-videos/".length);
        const res=await authenticatedFetch(`/storage/v1/object/sign/source-videos/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expiresIn:3600})});
        if(!res.ok) throw new Error("원본 영상 접근 시간이 만료됐거나 파일을 불러오지 못했습니다.");
        const data=await res.json();
        source=data.signedURL?.startsWith("http")?data.signedURL:`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${data.signedURL}`;
      }
      const restored=(row.clips||[]).map((c,index)=>({
        id:index+1,dbClipId:c.id,projectId:row.id,hook:c.title,start:Number(c.start_seconds),duration:Number(c.end_seconds)-Number(c.start_seconds),score:c.score,transcript:c.transcript,
        ...c.caption_style,...c.caption_style?.playback,...c.caption_style?.media,design:c.caption_style?.design||row.design_settings,
        mediaLoading:false,mediaError:false
      }));
      for(const clip of restored){if(clip.outputStoragePath){clip.finalVideoUrl=await signedOutputUrl(clip.outputStoragePath);clip.outputState="completed";}}
      setFileUrl(source);setResults(restored);setYtMeta({title:row.title});setPreview(null);setPage("results");

      if(!source&&restored.every(c=>!c.videoUrl&&!c.finalVideoUrl&&!c.remoteJobId)) setToast("이전 프로젝트에 재생 주소가 저장되지 않았습니다. 원본을 다시 연결해주세요.");
    }catch(error){setToast(error.message);}finally{setOpeningProject(null);}
  }

  async function signedOutputUrl(path){
    const res=await authenticatedFetch(`/storage/v1/object/sign/rendered-videos/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:3600})});
    if(!res.ok)throw new Error('저장된 완성 영상을 불러오지 못했습니다.');
    const data=await res.json();return data.signedURL?.startsWith('http')?data.signedURL:`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${data.signedURL}`;
  }

  async function prepareFinalClip(clip){
    let avatars=[];
    const update=patch=>setResults(previous=>previous.map(c=>c.dbClipId===clip.dbClipId?{...c,...patch}:c));
    update({outputState:'rendering',outputProgress:0,outputError:''});
    try{
      let response;
      if(clip.sourceClip&&clip.remoteJobId){
        const session=await getSession();
        response=await fetch(`/api/ai/recreate?action=content&jobId=${encodeURIComponent(clip.remoteJobId)}&token=${encodeURIComponent(clip.remoteAccessToken)}&clipId=${encodeURIComponent(clip.remoteClipId||'')}&index=${clip.remoteIndex||0}`,{headers:{Authorization:`Bearer ${session.access_token}`},signal:AbortSignal.timeout(60000)});
      }else{response=await fetch(clip.aiGenerated?clip.videoUrl:fileUrl);}
      if(!response.ok)throw new Error('원본 쇼츠를 불러오지 못했습니다.');
      const rawBlob=await response.blob();
      avatars=await loadCommentAvatarImages(clip.comments||[]);
      const renderClip={...clip,commentAvatarImages:avatars};
      const canvas=document.createElement('canvas');[canvas.width,canvas.height]=compositionSize(clip);
      const ctx=canvas.getContext('2d');
      const thumb=document.createElement('canvas');thumb.width=320;thumb.height=Math.round(canvas.height*320/canvas.width);
      const thumbCtx=thumb.getContext('2d');
      let thumbCaptured=false;
      const blob=await convertMp4(rawBlob,{start:clip.aiGenerated?0:clip.start,end:clip.aiGenerated?undefined:clip.start+clip.duration,canvas,draw:(frame,time)=>{drawComposition(ctx,renderClip,canvas,frame,time);if(!thumbCaptured&&time>=1){thumbCtx.drawImage(canvas,0,0,thumb.width,thumb.height);thumbCaptured=true;}},onProgress:p=>update({outputProgress:Math.round(p*95)})});
      const objectUrl=URL.createObjectURL(blob);outputUrlsRef.current.add(objectUrl);
      if(!thumbCaptured) thumbCtx.drawImage(canvas,0,0,thumb.width,thumb.height);
      const thumbnail=thumb.toDataURL('image/jpeg',.82);
      const storagePath=`${user.id}/${clip.projectId}/${clip.dbClipId}/${crypto.randomUUID()}.mp4`;
      const upload=await authenticatedFetch(`/storage/v1/object/rendered-videos/${storagePath}`,{method:'POST',headers:{'Content-Type':'video/mp4'},body:blob});
      if(!upload.ok)throw new Error('완성 MP4 저장에 실패했습니다. 편집하기에서 다시 저장해주세요.');
      const style={captions:clip.captions||[],reason:clip.reason||'',comments:clip.comments||[],thumbnailTitle:clip.thumbnailTitle||clip.hook,thumbnailSubtitle:clip.thumbnailSubtitle||'',design:clip.design,outputStoragePath:storagePath,media:{aiGenerated:!!clip.aiGenerated,sourceClip:!!clip.sourceClip,videoUrl:clip.videoUrl?.startsWith('blob:')?'':clip.videoUrl,remoteJobId:clip.remoteJobId,remoteAccessToken:clip.remoteAccessToken,remoteClipId:clip.remoteClipId,remoteIndex:clip.remoteIndex}};
      const saved=await authenticatedFetch(`/rest/v1/clips?id=eq.${clip.dbClipId}`,{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify({title:clip.hook,status:"ready",caption_style:style})});
      if(!saved.ok||(await saved.json()).length!==1)throw new Error('완성 영상 정보를 저장하지 못했습니다.');
      update({outputState:'completed',outputProgress:100,finalVideoUrl:objectUrl,outputStoragePath:storagePath,thumbnail});
      // Rendering runs in clip order; the first completed output becomes the project cover.
      if(clip.id===1||!projects.find(p=>p.id===clip.projectId)?.thumbnail){
        const patch=await authenticatedFetch(`/rest/v1/projects?id=eq.${clip.projectId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({thumbnail_data:thumbnail,design_settings:clip.design})});
        if(patch.ok)setProjects(previous=>previous.map(p=>p.id===clip.projectId?{...p,thumbnail}:p));
      }
    }catch(error){update({outputState:'error',outputError:error.message});}
    finally{avatars.forEach(image=>image?.close?.());}
  }

  useEffect(()=>{
    if(!user||outputBusyRef.current)return;
    const next=results.find(c=>c.dbClipId&&!c.testMode&&!c.outputState&&!c.mediaLoading&&(c.videoUrl||c.remoteJobId||fileUrl));
    if(!next)return;
    outputBusyRef.current=true;
    prepareFinalClip(next).finally(()=>{outputBusyRef.current=false;setRenderTick(n=>n+1);});
  },[results,user,fileUrl,renderTick]);

  async function downloadFinal(clip){
    if(!hasDownloadAccess())return setDownloadPaywall(true);
    if(clip.outputState!=='completed')return setToast('최종 MP4가 완성된 후 다운로드할 수 있습니다.');
    try{
      const url=clip.finalVideoUrl?.startsWith('blob:')?clip.finalVideoUrl:await signedOutputUrl(clip.outputStoragePath);
      const response=await fetch(url);if(!response.ok)throw new Error('완성 영상을 불러오지 못했습니다.');
      const blob=await response.blob();const local=URL.createObjectURL(blob);outputUrlsRef.current.add(local);
      const link=document.createElement('a');link.href=local;link.download=`WEARON_SHORT_${clip.id}.mp4`;document.body.appendChild(link);link.click();link.remove();
    }catch(error){setToast(error.message);}
  }

  function saveClipEdits(){
    if(!editing)return;
    setResults(previous=>previous.map(c=>c.dbClipId===editing.dbClipId?{...editing,outputState:undefined,finalVideoUrl:'',outputStoragePath:'',thumbnail:'',outputError:''}:c));
    setEditing(null);setToast('수정한 디자인으로 MP4를 다시 생성합니다.');
  }

  async function updateProjectThumbnail(projectId,clips,source){
    for(const clip of clips){
      if(clip.testMode||clip.mediaLoading||clip.mediaError||!(clip.videoUrl||source)) continue;
      try{
        const thumbnail=await createCompositionPreview(clip,source);
        const response=await authenticatedFetch(`/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}`,{method:"PATCH",headers:{"Content-Type":"application/json","Prefer":"return=representation"},body:JSON.stringify({thumbnail_data:thumbnail,design_settings:clip.design||currentDesign()})});
        if(!response.ok||(await response.json()).length!==1) throw new Error("썸네일 저장 실패");
        setProjects(previous=>previous.map(p=>p.id===projectId?{...p,thumbnail}:p));
        return;
      }catch{ /* Try the next completed clip if this media URL is unavailable. */ }
    }
    setToast("프로젝트는 저장됐습니다. 썸네일은 프로젝트를 다시 열 때 재시도합니다.");
  }

  async function saveMyTemplate(){
    if(!user){setAuthModal(true);return;}
    if(!templateName.trim()) return setToast("템플릿 이름을 입력해주세요.");
    if(templateBusy) return;
    setTemplateBusy(true);
    try{
      const design=currentDesign();
      const clip=results.find(c=>!c.testMode&&!c.mediaLoading&&(c.videoUrl||fileUrl));
      const preview=await createCompositionPreview({...clip,design,hook:clip?.hook||templateName.trim()},fileUrl,!clip);
      const response=await authenticatedFetch("/rest/v1/user_templates",{method:"POST",headers:{"Content-Type":"application/json","Prefer":"return=representation"},body:JSON.stringify({user_id:user.id,name:templateName.trim().slice(0,80),design_settings:design,preview_data:preview})});
      if(!response.ok) throw new Error("템플릿을 저장하지 못했습니다.");
      const created=(await response.json())[0];
      if(!created) throw new Error("템플릿 저장 결과를 확인하지 못했습니다.");
      setMyTemplates(previous=>[created,...previous]);setTemplateName("");setToast("내 템플릿에 저장했습니다.");
    }catch(error){setToast(error.message||"미리보기 생성에 실패했습니다.");}finally{setTemplateBusy(false);}
  }

  function applyMyTemplate(template){
    const design=template.design_settings||{};
    setSelectedTemplate(design.template||"댓글형");setAspectRatio(design.aspectRatio||"9:16");setBrandColor(design.brandColor||"#7c5cff");
    setPage("home");setBuilderOpen(true);setToast(`${template.name} 템플릿을 적용했습니다.`);
  }

  useEffect(()=>{
    if(!builderOpen&&page!=="templates")return;
    let active=true;
    Promise.all([...templateData.map(x=>x[0]),'커뮤니티형'].map(async template=>[template,await createCompositionPreview({design:{template,aspectRatio,brandColor},hook:ytMeta?.title||'나만의 영상 제목'},'',true)])).then(entries=>{if(active)setPresetPreviews(Object.fromEntries(entries));}).catch(()=>{});
    return ()=>{active=false;};
  },[builderOpen,page,aspectRatio,brandColor,ytMeta?.id,fileUrl]);

  useEffect(()=>{
    if(page!=="templates") return;
    let active=true;
    createCompositionPreview({design:currentDesign(),hook:templateName||selectedTemplate},"",true).then(image=>{if(active)setTemplateDraftPreview(image);}).catch(()=>{});
    return ()=>{active=false;};
  },[page,selectedTemplate,aspectRatio,brandColor,templateName]);

  async function loadCloudProjects(){
    try{
      const res=await authenticatedFetch("/rest/v1/projects?select=id,title,status,created_at,thumbnail_data,design_settings,clips(count)&order=created_at.desc");
      if(!res.ok) throw new Error();
      const rows=await res.json();
      setProjects((rows||[]).map(p=>({
        id:p.id,
        title:p.title,
        clips:p.clips?.[0]?.count || 0,
        createdAt:new Date(p.created_at).toLocaleDateString("ko-KR"),
        thumbnail:p.thumbnail_data||"",
        design:p.design_settings||{},
        status:p.status
      })));
    }catch{
      setToast("프로젝트 목록을 불러오지 못했습니다.");
    }
  }

  async function saveCloudProject(title,clips,sourcePath="",sourceType="upload",sourceUrl=null){
    if(!user) return null;
    try{
      const res=await authenticatedFetch("/rest/v1/projects",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Prefer":"return=representation"
        },
        body:JSON.stringify({
          user_id:user.id,
          title,
          source_type:sourceType,
          source_filename:sourceType==="upload" ? title : null,
          source_url:sourceUrl || (sourcePath ? `storage://source-videos/${sourcePath}` : null),
          status:"ready",
          design_settings:clips[0]?.design||currentDesign()
        })
      });
      if(!res.ok) throw new Error(await res.text());
      const created=(await res.json())?.[0];
      if(!created) return null;

      if(sourcePath){
        const assetRes=await authenticatedFetch("/rest/v1/media_assets",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            user_id:user.id,
            project_id:created.id,
            kind:"source",
            storage_bucket:"source-videos",
            storage_path:sourcePath,
            mime_type:file?.type||null,
            duration_seconds:fileDuration||null,
            size_bytes:file?.size||null
          })
        });
        if(!assetRes.ok) throw new Error(await assetRes.text());
      }

      const clipRows=clips.map(c=>({
        user_id:user.id,
        project_id:created.id,
        title:c.hook,
        start_seconds:c.start,
        end_seconds:c.start+c.duration,
        score:c.score,
        transcript:c.transcript||null,
        caption_style:{
          captions:c.captions||[],
          reason:c.reason||"",
          comments:c.comments||[],
          thumbnailTitle:c.thumbnailTitle||c.hook||"",
          thumbnailSubtitle:c.thumbnailSubtitle||"",
          design:c.design||currentDesign(),
          media:{aiGenerated:!!c.aiGenerated,sourceClip:!!c.sourceClip,videoUrl:c.videoUrl&&!c.videoUrl.startsWith("blob:")?c.videoUrl:"",remoteJobId:c.remoteJobId,remoteAccessToken:c.remoteAccessToken,remoteClipId:c.remoteClipId,remoteIndex:c.remoteIndex}
        },
        status:"candidate"
      }));

      const clipRes=await authenticatedFetch("/rest/v1/clips",{
        method:"POST",
        headers:{"Content-Type":"application/json","Prefer":"return=representation"},
        body:JSON.stringify(clipRows)
      });
      if(!clipRes.ok) throw new Error(await clipRes.text());

      const storedRows=await clipRes.json();
      const savedClips=clips.map((c,i)=>({...c,dbClipId:storedRows[i]?.id,projectId:created.id,design:c.design||currentDesign()}));
      setResults(previous=>previous.map(c=>{const match=savedClips.find(x=>x.remoteClipId?x.remoteClipId===c.remoteClipId:x.id===c.id);return match?{...c,projectId:created.id,dbClipId:match.dbClipId,design:match.design}:c;}));
      setProjects(previous=>[{id:created.id,title,clips:clips.length,status:"ready",createdAt:new Date(created.created_at).toLocaleDateString("ko-KR"),thumbnail:"",design:savedClips[0]?.design},...previous.filter(p=>p.id!==created.id)]);
      // The representative thumbnail is captured after the composed MP4 finishes.
      return created;
    }catch{
      setToast("프로젝트 저장에 실패했습니다.");
      return null;
    }
  }

  async function loadAdminStatus(){
    try{
      const session=await getSession();
      if(!session?.access_token) {
        setIsAdmin(false);
        return false;
      }
      const res=await fetch("/api/admin/status",{
        headers:{Authorization:`Bearer ${session.access_token}`},
        cache:"no-store"
      });
      const data=await res.json();
      const allowed=Boolean(res.ok && data?.isAdmin);
      setIsAdmin(allowed);
      setAdminTestMode(false);
      return allowed;
    }catch{
      setIsAdmin(false);
      setAdminTestMode(false);
      return false;
    }
  }

  async function submitAuth(e){
    e.preventDefault();
    if(!authEmail.trim() || !authPassword) return setToast("이메일과 비밀번호를 입력해주세요.");
    if(authPassword.length<6) return setToast("비밀번호는 6자 이상으로 입력해주세요.");

    try{
      setAuthBusy(true);
      if(authMode==="signup"){
        const data=await signUp({
          email:authEmail.trim(),
          password:authPassword,
          fullName:authName.trim()
        });

        if(data?.access_token){
          const current=await getCurrentUser();
          setUser(current);
          setAuthModal(false);
          await Promise.all([loadCloudProjects(),loadCloudTemplates(),loadSubscription(),loadAdminStatus()]);
          setToast("회원가입이 완료되었습니다.");
        }else{
          setAuthStep("verify");
          setAuthCode("");
          setToast("인증번호를 이메일로 보냈습니다.");
        }
      }else{
        await signIn({email:authEmail.trim(),password:authPassword});
        const current=await getCurrentUser();
        setUser(current);
        setAuthModal(false);
        await Promise.all([loadCloudProjects(),loadCloudTemplates(),loadSubscription(),loadAdminStatus()]);
        setToast("로그인했습니다.");
      }
    }catch(err){
      const msg=err?.message || "";
      if(authMode==="login" && msg.toLowerCase().includes("email not confirmed")){
        setAuthStep("verify");
        setAuthMode("signup");
        setAuthCode("");
        setToast("이메일 인증이 필요합니다. 인증번호를 입력해주세요.");
      }else{
        setToast(msg || "로그인 처리 중 오류가 발생했습니다.");
      }
    }finally{
      setAuthBusy(false);
    }
  }

  async function verifyCode(e){
    e.preventDefault();
    const code=authCode.replace(/\D/g,"").slice(0,10);
    if(code.length<6) return setToast("이메일로 받은 인증번호를 입력해주세요.");

    try{
      setAuthBusy(true);
      await verifyEmailOtp({email:authEmail.trim(),token:code});
      const current=await getCurrentUser();
      setUser(current);
      setAuthModal(false);
      setAuthStep("form");
      setAuthCode("");
      setAuthPassword("");
      await Promise.all([loadCloudProjects(),loadCloudTemplates(),loadSubscription(),loadAdminStatus()]);
      setToast("이메일 인증이 완료되었습니다.");
    }catch(err){
      setToast(err?.message || "인증번호가 올바르지 않거나 만료되었습니다.");
    }finally{
      setAuthBusy(false);
    }
  }

  async function resendConfirmation(){
    if(!authEmail.trim()) return setToast("가입한 이메일을 먼저 입력해주세요.");
    try{
      setAuthBusy(true);
      await resendSignupConfirmation(authEmail.trim());
      setToast("인증번호를 다시 보냈습니다.");
    }catch(err){
      const msg=err?.message || "";
      if(msg.toLowerCase().includes("security purposes") || msg.includes("rate")) {
        setToast("잠시 후 다시 시도해주세요. 인증 메일 재전송에는 시간 제한이 있습니다.");
      } else {
        setToast(msg || "인증 메일 재전송에 실패했습니다.");
      }
    }finally{
      setAuthBusy(false);
    }
  }

  async function logout(){
    try{
      await signOut();
    }finally{
      setUser(null);
      setProjects([]);setMyTemplates([]);
      setIsAdmin(false);
      setAdminTestMode(false);
      setSubscription({plan:"free",status:"active",current_period_end:null});
      setPage("home");
      setToast("로그아웃했습니다.");
    }
  }

  async function loadTrending(){
    try{
      setTrendStatus("loading");
      const res=await fetch("/api/youtube/trending?region=KR&maxResults=16",{cache:"no-store"});
      const data=await res.json();
      if(!res.ok) throw new Error(data.message||"YouTube 데이터 연결 대기");
      setTrending(data.items||[]);
      setTrendStatus("live");
    }catch{
      setTrendStatus("key");
      setTrending([]);
    }
  }

  async function startFromTrending(video){
    const nextUrl=String(video?.url||"");
    if(!nextUrl) return;
    setSourceMode("youtube");
    setUrl(nextUrl);
    setPage("home");
    setBuilderOpen(false);
    setYtMeta(null);
    setToast("인기 영상을 새 프로젝트에 불러오는 중...");
    try{
      const res=await fetch(`/api/youtube/video?url=${encodeURIComponent(nextUrl)}`);
      const data=await res.json();
      if(!res.ok) throw new Error();
      setYtMeta(data);
      const total=durationToSeconds(data.duration)||60;
      setRangeStart(0);
      setRangeEnd(Math.min(total,840));
      setBuilderOpen(true);
      setToast("인기 영상을 불러왔습니다. 구간과 템플릿을 선택하세요.");
    }catch{
      setToast("영상 정보를 불러오지 못했습니다. 링크는 입력해두었습니다.");
    }
  }

  async function inspectYoutube(){
    if(!url.trim()) return setToast("YouTube 링크를 입력해주세요.");
    try{
      const res=await fetch(`/api/youtube/video?url=${encodeURIComponent(url.trim())}`);
      const data=await res.json();
      if(!res.ok) throw new Error();
      setYtMeta(data);
      const total=durationToSeconds(data.duration)||60;
      setRangeStart(0);
      setRangeEnd(Math.min(total,840));
      setBuilderOpen(true);
      setToast("영상 정보를 불러왔습니다. 아래에서 쇼츠 설정을 선택하세요.");
    }catch{
      setToast("YouTube 링크를 확인해주세요.");
    }
  }

  function onFile(f){
    if(!f) return;
    if(fileUrl) URL.revokeObjectURL(fileUrl);
    const local=URL.createObjectURL(f);
    setFile(f);
    setFileUrl(local);
    setFileDuration(0);
    setSourceStoragePath("");
    setSourceMode("upload");

    const probe=document.createElement("video");
    probe.preload="metadata";
    probe.src=local;
    probe.onloadedmetadata=()=>{
      if(Number.isFinite(probe.duration)){
        setFileDuration(probe.duration);
        if(!ytMeta){
          setRangeStart(0);
          setRangeEnd(Math.min(probe.duration,840));
        }else if(rangeEnd>probe.duration){
          setRangeEnd(probe.duration);
        }
      }
    };

    setBuilderOpen(true);
    setToast(ytMeta ? "원본 파일이 연결됐습니다. 이제 쇼츠를 생성할 수 있습니다." : "원본 영상이 준비됐습니다.");
  }

  async function uploadSourceVideo(){
    if(!user || !file) throw new Error("업로드할 원본 영상이 없습니다.");
    if(sourceStoragePath) return sourceStoragePath;

    const ext=(file.name.split(".").pop()||"mp4").toLowerCase().replace(/[^a-z0-9]/g,"")||"mp4";
    const storagePath=`${user.id}/${crypto.randomUUID()}.${ext}`;
    const encoded=storagePath.split("/").map(encodeURIComponent).join("/");

    const res=await authenticatedFetch(`/storage/v1/object/source-videos/${encoded}`,{
      method:"POST",
      headers:{
        "Content-Type":file.type||"application/octet-stream",
        "x-upsert":"false"
      },
      body:file
    });

    if(!res.ok){
      const detail=await res.text();
      throw new Error(detail||"원본 영상 업로드에 실패했습니다.");
    }

    setSourceStoragePath(storagePath);
    return storagePath;
  }

  async function runAdminLinkTest(){
    setPage("analysis");
    setAnalysis(8);
    setAnalysisMsg("관리자 무료 테스트 모드 · 외부 클리핑 API를 호출하지 않습니다.");

    const steps=[
      [28,"영상 구간과 제목 구성을 테스트하는 중..."],
      [58,"자막·하이라이트·점수 화면을 준비하는 중..."],
      [84,"쇼츠 프로젝트 결과를 구성하는 중..."],
      [100,"관리자 무료 테스트가 완료됐습니다."]
    ];

    for(const [progress,message] of steps){
      await new Promise(resolve=>setTimeout(resolve,420));
      setAnalysis(progress);
      setAnalysisMsg(message);
    }

    const baseTitle=String(ytMeta?.title||"YouTube 영상").replace(/\s+/g," ").trim();
    const shortTitle=baseTitle.length>26 ? baseTitle.slice(0,26)+"…" : baseTitle;
    const thumb=ytMeta?.thumbnail||"/images/%EC%82%BC%EC%83%89%20%EC%98%81%EC%83%81%20%ED%8C%A8%EB%84%90%20W%20%EB%A1%9C%EA%B3%A0.png";
    const newResults=[
      {
        id:1,score:94,start:12,duration:42,
        hook:`${shortTitle} · 핵심 장면`,
        reason:"초반에 시선을 잡기 좋은 핵심 장면으로 구성한 무료 테스트 예시입니다.",
        script:"[테스트 자막] 영상의 핵심 내용을 짧고 빠르게 전달하는 구간입니다.",
        aiGenerated:true,testMode:true,previewImage:thumb
      },
      {
        id:2,score:89,start:74,duration:36,
        hook:"반응이 크게 나올 포인트",
        reason:"반응·놀라움·정보성이 함께 보이는 구간처럼 결과 화면을 테스트합니다.",
        script:"[테스트 자막] 시청자가 멈춰 볼 만한 포인트를 강조하는 예시입니다.",
        aiGenerated:true,testMode:true,previewImage:thumb
      },
      {
        id:3,score:86,start:132,duration:31,
        hook:"한 번 더 보게 만드는 장면",
        reason:"쇼츠 후보가 여러 개 생성된 것처럼 프로젝트 목록과 다운로드 흐름을 확인합니다.",
        script:"[테스트 자막] 실제 AI 호출 없이 레이아웃과 사용자 흐름만 확인합니다.",
        aiGenerated:true,testMode:true,previewImage:thumb
      },
      {
        id:4,score:82,start:188,duration:28,
        hook:"마지막 핵심 요약",
        reason:"마무리 구간의 제목·설명·점수·타임라인 표시를 테스트합니다.",
        script:"[테스트 자막] 실제 AI 모드에서는 전사된 자막과 분석 결과가 여기에 표시됩니다.",
        aiGenerated:true,testMode:true,previewImage:thumb
      }
    ];

    setPreview(null);
    setResults(newResults);
    setTimeout(()=>setPage("results"),220);
  }

  async function runAdminUploadTest(){
    setPage("analysis");
    setAnalysis(10);
    setAnalysisMsg("관리자 무료 테스트 모드 · 원본 파일은 API로 보내지 않습니다.");

    await new Promise(resolve=>setTimeout(resolve,450));
    setAnalysis(48);
    setAnalysisMsg("테스트용 전사·하이라이트 분석 단계를 확인하는 중...");
    await new Promise(resolve=>setTimeout(resolve,450));
    setAnalysis(82);
    setAnalysisMsg("테스트용 쇼츠 후보를 준비하는 중...");
    await new Promise(resolve=>setTimeout(resolve,450));

    const total=Math.max(24,Number(fileDuration||60));
    const starts=[0,Math.min(Math.max(0,total*.32),Math.max(0,total-12)),Math.min(Math.max(0,total*.64),Math.max(0,total-12))];
    const newResults=starts.map((start,index)=>({
      id:index+1,
      score:95-(index*4),
      start:Number(start.toFixed(1)),
      duration:Number(Math.min(12,Math.max(8,total-start)).toFixed(1)),
      hook:`관리자 테스트 후보 ${index+1}`,
      reason:"외부 클리핑 API 호출 없이 원본 편집 화면과 렌더링 흐름을 확인하는 테스트 후보입니다.",
      captions:[],
      transcript:"",
      testMode:true
    }));

    setResults(newResults);
    setPreview(null);
    setAnalysis(100);
    setAnalysisMsg("관리자 무료 테스트가 완료됐습니다.");
    setTimeout(()=>setPage("results"),250);
  }

  function storePendingYoutubeJob(job){
    setPendingYoutubeJob(job);
    try{ window.localStorage.setItem(PENDING_YOUTUBE_JOB_KEY,JSON.stringify(job)); }catch{}
  }

  function clearPendingYoutubeJob(){
    setPendingYoutubeJob(null);
    try{ window.localStorage.removeItem(PENDING_YOUTUBE_JOB_KEY); }catch{}
  }

  async function watchYoutubeJob(job,{resume=false}={}){
    if(!job?.jobId || !job?.accessToken || pendingWatcherRef.current) return;
    pendingWatcherRef.current=true;

    try{
      const session=await getSession();
      if(!session?.access_token) throw new Error("로그인이 만료되었습니다. 다시 로그인해주세요.");

      const meta=job?.meta||{};
      if(meta?.title || meta?.thumbnail || Array.isArray(meta?.comments)) setYtMeta(meta);

      const realComments=Array.isArray(meta?.comments)?meta.comments:[];

      const buildResults=(status)=>{
        const clips=Array.isArray(status?.clips)?status.clips.slice(0,6):[];
        return clips.map((clipMeta,index)=>{
          const duration=Number(clipMeta?.duration||0)||35;
          const fallbackTitle=String(meta?.title||"YouTube 영상").replace(/\s+/g," ").trim();
          const hook=String(clipMeta?.title||`${fallbackTitle} · 핵심 장면 ${index+1}`).slice(0,100);
          const videoUrl=String(clipMeta?.previewUrl||clipMeta?.exportUrl||"");
          const remoteClipId=String(clipMeta?.clipId||"");

          return {
            id:index+1,
            score:Number(clipMeta?.score||0)||Math.max(80,95-index*3),
            start:Number(clipMeta?.start||0),
            duration,
            hook,
            reason:"AI가 원본 전체 영상에서 쇼츠로 보기 좋은 핵심 장면을 골라낸 결과입니다.",
            transcript:String(clipMeta?.transcript||""),
            comments:selectRelevantComments(realComments,{title:hook,transcript:clipMeta?.transcript}),
            design:job.design||currentDesign(),
            thumbnailTitle:hook,
            thumbnailSubtitle:"핵심 장면",
            aiGenerated:true,
            sourceClip:true,
            videoUrl,
            mediaLoading:!videoUrl,
            mediaError:false,
            remoteJobId:job.jobId,
            remoteAccessToken:job.accessToken,
            remoteIndex:index,
            remoteClipId
          };
        });
      };

      let completed=null;
      let resultsShown=Boolean(job?.resultsShown);
      let lastReadyCount=Number(job?.readyClipCount||0);

      for(let attempt=0;attempt<600;attempt++){
        // 첫 결과를 최대한 빨리 잡되, OpusClip 분석/렌더링 품질 설정은 전혀 바꾸지 않습니다.
        if(attempt>0){
          const waitMs=attempt<40?1250:attempt<100?2500:5000;
          await new Promise(resolve=>setTimeout(resolve,waitMs));
        }

        const statusRes=await fetch(
          `/api/ai/recreate?action=status&jobId=${encodeURIComponent(job.jobId)}&token=${encodeURIComponent(job.accessToken)}`,
          {headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"}
        );
        const status=await statusRes.json();

        if(!statusRes.ok){
          const transient=statusRes.status>=500 || statusRes.status===429;
          if(transient){
            const next={...job,progress:job.progress||18,message:"OpusClip 처리 중 · 자동으로 다시 확인합니다."};
            job=next;
            storePendingYoutubeJob(next);
            continue;
          }
          throw new Error(status?.message||"자동 컷 상태를 확인하지 못했습니다.");
        }

        if(status?.status==="failed"){
          throw new Error(status?.error?.message||"YouTube 자동 컷 생성에 실패했습니다.");
        }

        const readyCount=Math.min(6,Math.max(0,Number(status?.readyClipCount||status?.clipCount||0)));
        const providerProgress=Math.max(0,Math.min(100,Number(status?.progress||0)));
        const visualProgress=status?.status==="completed"
          ? 100
          : Math.min(96,providerProgress);

        const fallbackMessage=readyCount
          ? `쇼츠 ${readyCount}/6개 준비됨 · 나머지는 뒤에서 계속 생성 중...`
          : visualProgress<30
            ? "YouTube 원본 영상을 불러오는 중..."
            : visualProgress<65
              ? "AI가 전체 영상에서 핵심 장면을 분석하는 중..."
              : "선택한 장면을 쇼츠 영상으로 렌더링하는 중...";

        const message=String(status?.message||fallbackMessage);
        const firstReady=Array.isArray(status?.clips)&&status.clips.length?status.clips[0]:null;
        const next={
          ...job,
          progress:Math.round(visualProgress),
          message,
          phase:status?.phase||job?.phase||"analyze",
          readyClipCount:readyCount,
          previewUrl:String(firstReady?.previewUrl||job?.previewUrl||""),
          previewTitle:String(firstReady?.title||job?.previewTitle||""),
          resultsShown:resultsShown||readyCount>0
        };
        job=next;
        storePendingYoutubeJob(next);
        setAnalysis(Math.round(visualProgress));
        setAnalysisMsg(message);

        // 첫 쇼츠가 준비되는 즉시 결과 화면을 열고, 이후 쇼츠는 같은 화면에 추가합니다.
        if(readyCount>0 && Array.isArray(status?.clips) && status.clips.length){
          const partialResults=buildResults(status);
          setResults(previous=>partialResults.map(c=>({...c,...previous.find(p=>p.remoteClipId===c.remoteClipId)})));

          if(!resultsShown){
            resultsShown=true;
            lastReadyCount=readyCount;
            job={...job,resultsShown:true};
            storePendingYoutubeJob(job);
            setPreview(null);
            setPage("results");
            setToast(`첫 쇼츠가 준비됐습니다. 현재 ${readyCount}/6개 · 나머지는 자동 생성 중입니다.`);
          }else if(readyCount>lastReadyCount){
            lastReadyCount=readyCount;
            setToast(`쇼츠 ${readyCount}/6개 준비됐습니다. 계속 자동 생성 중입니다.`);
          }
        }

        if(status?.status==="completed"){
          completed=status;
          break;
        }
      }

      if(!completed){
        const next={...job,progress:Math.max(88,job.progress||0),message:"작업이 계속 진행 중입니다. 결과 화면에서 자동으로 이어서 확인합니다."};
        storePendingYoutubeJob(next);
        setToast("작업이 길어지고 있지만 중단된 것은 아닙니다.");
        return;
      }

      const finalResults=buildResults(completed);
      if(!finalResults.length) throw new Error("AI 분석은 완료됐지만 완성된 쇼츠 파일을 찾지 못했습니다.");

      clearPendingYoutubeJob();
      void loadCreditBalance();
      setResults(previous=>finalResults.map(c=>({...c,...previous.find(p=>p.remoteClipId===c.remoteClipId)})));
      setPreview(null);
      setAnalysis(100);
      setAnalysisMsg("YouTube 원본 영상에서 쇼츠 후보 생성이 완료됐습니다.");
      setPage("results");
      setToast(`장면 선택 완료 · ${finalResults.length}개 최종 MP4를 준비합니다.`);

      void saveCloudProject(
        meta?.title||"YouTube 자동 쇼츠",
        finalResults,
        "",
        "youtube",
        job.youtubeUrl
      );
    }catch(err){
      const next={...job,error:err?.message||"자동 쇼츠 처리 중 오류가 발생했습니다.",message:"오류가 발생했습니다. 다시 확인을 누르면 이어서 확인합니다."};
      storePendingYoutubeJob(next);
      if(!resume && !job?.resultsShown) setPage("projects");
      setToast(next.error);
    }finally{
      pendingWatcherRef.current=false;
    }
  }

  async function generateYoutubeShort(){
    if(isAdmin && adminTestMode) return runAdminLinkTest();

    setCreditWarning("");
    setAnalysis(8);
    setAnalysisMsg("YouTube 자동 컷 작업을 시작하는 중...");

    try{
      const session=await getSession();
      if(!session?.access_token) throw new Error("로그인이 만료되었습니다. 다시 로그인해주세요.");

      const createRes=await fetch("/api/ai/recreate",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          Authorization:`Bearer ${session.access_token}`
        },
        body:JSON.stringify({
          youtubeUrl:url.trim(),
          aspectRatio,
          brandColor,
          sourceDurationSec:durationToSeconds(ytMeta?.duration||""),
          analysisStart:rangeStart,analysisEnd:rangeEnd,template:selectedTemplate,
          expectedCredits:quote.total,requestId:requestIdRef.current||(requestIdRef.current=crypto.randomUUID())
        })
      });

      const created=await createRes.json();
      if(!createRes.ok){
        if(created?.code==='GENERATION_FAILED') requestIdRef.current=null;
        if(created?.code==="INSUFFICIENT_OPUS_CREDITS"){
          setCreditWarning(created?.message||"OpusClip 크레딧이 부족합니다.");
        }
        throw new Error(created?.message||"YouTube 자동 컷 작업을 시작하지 못했습니다.");
      }

      const job={
        jobId:created.jobId,
        design:currentDesign(),
        accessToken:created.accessToken,
        youtubeUrl:url.trim(),
        progress:12,
        message:`선택한 ${clock(rangeStart)}–${clock(rangeEnd)} 구간을 분석하고 있습니다.`,
        quote:created.quote||quote,
        createdAt:Date.now(),
        meta:{
          title:ytMeta?.title||"YouTube 자동 쇼츠",
          channelTitle:ytMeta?.channelTitle||"",
          thumbnail:ytMeta?.thumbnail||"",
          comments:Array.isArray(ytMeta?.comments)?ytMeta.comments.slice(0,12):[],
          analysisStart:rangeStart,analysisEnd:rangeEnd
        }
      };

      void loadCreditBalance();
      storePendingYoutubeJob(job);
      setPage("analysis");
      setToast("작업을 시작했습니다. 진행 상황을 실시간으로 보여드립니다.");
      void watchYoutubeJob(job);
    }catch(err){
      setPage("home");
      setAnalysis(0);
      setAnalysisMsg("");
      setToast(err?.message||"YouTube 자동 쇼츠 생성에 실패했습니다.");
    }
  }

  async function startProject(){
    if(!quote||!sourceSeconds||rangeStart<0||rangeEnd>sourceSeconds||rangeEnd-rangeStart<8) return setToast("8초 이상 사용할 구간을 선택해주세요.");
    if(!authReady) return setToast("로그인 상태를 확인하고 있습니다.");
    if(!user){
      setAuthMode("login");
      setAuthModal(true);
      return setToast("쇼츠 프로젝트를 만들려면 먼저 로그인해주세요.");
    }

    if(sourceMode==="youtube" && !ytMeta){
      return setToast("먼저 YouTube 링크의 영상 정보를 불러와주세요.");
    }

    if(!isAdmin && !hasDownloadAccess()){
      setPage("pricing");
      return setToast("쇼츠 자동 생성은 활성 유료 이용권이 필요합니다.");
    }

    if(sourceMode==="youtube" && !file){
      if(!rightsConfirmed) return setToast("원본 영상의 쇼츠 제작 권리 확인에 체크해주세요.");
      return generateYoutubeShort();
    }

    if(!file) return setToast("원본 영상 파일을 선택해주세요.");
    if(!rightsConfirmed) return setToast("원본 영상의 권리 확인에 체크해주세요.");
    if(rangeEnd-rangeStart<8) return setToast("분석 구간을 최소 8초 이상 선택해주세요.");
    if(isAdmin && adminTestMode) return runAdminUploadTest();

    try{
      setPage("analysis");
      setAnalysis(5);
      setAnalysisMsg("원본 영상을 안전하게 업로드하는 중...");

      const storagePath=await uploadSourceVideo();
      setAnalysisMsg("선택 구간만 분석 파일로 준비하는 중...");
      const analysisBlob=await convertMp4(file,{start:rangeStart,end:rangeEnd});
      const analysisPath=`${user.id}/${crypto.randomUUID()}/analysis.mp4`;
      const analysisUpload=await authenticatedFetch(`/storage/v1/object/source-videos/${analysisPath}`,{method:'POST',headers:{'Content-Type':'video/mp4'},body:analysisBlob});
      if(!analysisUpload.ok)throw new Error('선택 구간 업로드에 실패했습니다.');
      setAnalysis(24);
      setAnalysisMsg("AI가 음성을 실제로 전사하고 있습니다...");

      const session=await getSession();
      if(!session?.access_token) throw new Error("로그인이 만료되었습니다. 다시 로그인해주세요.");

      const res=await fetch("/api/ai/analyze",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          Authorization:`Bearer ${session.access_token}`
        },
        body:JSON.stringify({
          sourcePath:storagePath,analysisPath,
          expectedCredits:quote.total,requestId:requestIdRef.current||(requestIdRef.current=crypto.randomUUID()),
          filename:"analysis.mp4",
          mimeType:file.type||"video/mp4",
          duration:fileDuration||0,
          analysisStart:rangeStart,
          analysisEnd:rangeEnd,
          hookLanguage,
          template:selectedTemplate,
          aspectRatio
        })
      });

      setAnalysis(72);
      setAnalysisMsg("AI가 후킹·정보밀도·완결성을 기준으로 구간을 고르는 중...");

      const data=await res.json();
      if(!res.ok) throw new Error(data?.message||"AI 쇼츠 분석에 실패했습니다.");

      const newResults=(data?.clips||[]).map((clip,index)=>({
        ...clip,
        id:index+1,
        design:currentDesign(),comments:selectRelevantComments(ytMeta?.comments||[],clip)
      }));
      if(newResults.length!==3) throw new Error("AI가 쇼츠 후보 3개를 만들지 못했습니다.");

      setAnalysis(92);
      setAnalysisMsg("선택한 쇼츠 후보를 저장하는 중...");

      setResults(newResults);
      await saveCloudProject(ytMeta?.title || file.name,newResults,storagePath);
      void loadCreditBalance();
      setPreview(null);
      setAnalysis(100);
      setAnalysisMsg("AI 분석이 완료됐습니다.");
      setTimeout(()=>setPage("results"),300);
    }catch(err){
      setPage("home");
      setAnalysis(0);
      setAnalysisMsg("");
      setToast(err?.message||"AI 쇼츠 생성에 실패했습니다.");
    }
  }


  function hasDownloadAccess(){
    if(isAdmin) return true;
    const plan=String(subscription?.plan||"free").toLowerCase();
    const active=subscription?.status==="active";
    const paid=["starter","pro","business"].includes(plan);
    if(!active || !paid) return false;
    if(!subscription?.current_period_end) return true;
    return new Date(subscription.current_period_end).getTime() > Date.now();
  }

  function requestDownload(clip){
    if(!hasDownloadAccess()){
      setDownloadPaywall(true);
      return;
    }
    if(clip?.aiGenerated) return downloadGeneratedClip(clip);
    return renderClip(clip);
  }

  async function requestFastDownload(clip){
    if(!hasDownloadAccess()){
      setDownloadPaywall(true);
      return;
    }
    if(clip?.testMode) return downloadAdminTestVideo(clip);
    if(clip?.sourceClip) return renderGeneratedClip(clip);

    try{
      if(!clip?.videoUrl) return setToast("받을 쇼츠 영상이 없습니다.");
      const a=document.createElement("a");
      a.href=clip.videoUrl;
      a.download=`WEARON_SHORT_${clip?.id||1}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setToast("다운로드를 시작했습니다.");
    }catch{
      setToast("다운로드에 실패했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  function openPlansFromPaywall(){
    setDownloadPaywall(false);
    if(isAdmin){
      setToast("관리자 계정은 다운로드 제한 없이 이용됩니다.");
      return;
    }
    setPage("pricing");
  }

  function wrapCanvasText(ctx,text,maxWidth,maxLines=2){
    const words=String(text||"").trim().split(/\s+/).filter(Boolean);
    const lines=[];
    let line="";
    for(const word of words){
      const next=line ? `${line} ${word}` : word;
      if(ctx.measureText(next).width>maxWidth && line){
        lines.push(line);
        line=word;
        if(lines.length>=maxLines-1) break;
      }else{
        line=next;
      }
    }
    if(line && lines.length<maxLines) lines.push(line);
    const consumed=lines.join(" ");
    if(words.join(" ").length>consumed.length && lines.length){
      let last=lines[lines.length-1];
      while(last.length>2 && ctx.measureText(last+"…").width>maxWidth) last=last.slice(0,-1);
      lines[lines.length-1]=last+"…";
    }
    return lines;
  }

  function commentText(comment){
    return typeof comment==="string" ? comment : String(comment?.text||"");
  }

  function commentAuthor(comment){
    return typeof comment==="string" ? "YouTube 댓글" : String(comment?.author||"YouTube 댓글");
  }

  function commentLikes(comment){
    return typeof comment==="string" ? 0 : Number(comment?.likeCount||0);
  }

  function commentAvatar(comment){
    return typeof comment==="string" ? "" : String(comment?.avatar||"");
  }

  function sourceVideoRect(canvas){
    const landscape=canvas.width>canvas.height;
    const width=landscape?Math.round(canvas.width*.62):canvas.width;
    const height=Math.min(Math.round(width*9/16),Math.round(canvas.height*(landscape?.62:.40)));
    const y=Math.round(canvas.height*(landscape?.24:.13));
    return {x:landscape?Math.round(canvas.width*.025):0,y,width,height};
  }

  function roundRectPath(ctx,x,y,w,h,r){
    const radius=Math.max(0,Math.min(r,w/2,h/2));
    ctx.beginPath();
    ctx.moveTo(x+radius,y);
    ctx.arcTo(x+w,y,x+w,y+h,radius);
    ctx.arcTo(x+w,y+h,x,y+h,radius);
    ctx.arcTo(x,y+h,x,y,radius);
    ctx.arcTo(x,y,x+w,y,radius);
    ctx.closePath();
  }

  function drawMosaicName(ctx,x,y,width,height){
    const cols=9;
    const gap=Math.max(2,Math.round(height*.12));
    const cellW=(width-gap*(cols-1))/cols;
    for(let i=0;i<cols;i++){
      ctx.fillStyle=i%3===0?"#777d87":i%3===1?"#555b65":"#9298a2";
      ctx.fillRect(x+i*(cellW+gap),y,cellW,height);
    }
  }

  function drawAvatar(ctx,img,cx,cy,r){
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.clip();
    if(img){
      const iw=img.width||img.naturalWidth||r*2;
      const ih=img.height||img.naturalHeight||r*2;
      const ratio=Math.max((r*2)/iw,(r*2)/ih);
      const dw=iw*ratio, dh=ih*ratio;
      ctx.drawImage(img,cx-dw/2,cy-dh/2,dw,dh);
    }else{
      ctx.fillStyle="#31343a";
      ctx.fillRect(cx-r,cy-r,r*2,r*2);
    }
    ctx.restore();
  }

  async function loadCommentAvatarImages(comments=[]){
    return Promise.all((comments||[]).slice(0,12).map(async(comment)=>{
      const avatar=commentAvatar(comment);
      if(!avatar) return null;
      try{
        const res=await fetch(`/api/youtube/avatar?url=${encodeURIComponent(avatar)}`,{cache:"force-cache",signal:AbortSignal.timeout(10000)});
        if(!res.ok) return null;
        const blob=await res.blob();
        return await createImageBitmap(blob);
      }catch{
        return null;
      }
    }));
  }

  function drawYoutubeCommentCard(ctx,item,avatar,x,y,w,h){
    roundRectPath(ctx,x,y,w,h,Math.round(h*.10));
    ctx.fillStyle="rgba(20,20,22,.98)";
    ctx.fill();
    ctx.strokeStyle="rgba(255,255,255,.08)";
    ctx.lineWidth=Math.max(1,Math.round(w*.002));
    ctx.stroke();

    const pad=Math.round(w*.035);
    const avatarR=Math.max(24,Math.round(h*.14));
    const avatarX=x+pad+avatarR;
    const avatarY=y+pad+avatarR;
    drawAvatar(ctx,avatar,avatarX,avatarY,avatarR);

    const textX=avatarX+avatarR+Math.round(w*.025);
    const right=x+w-pad;

    // 실제 작성자 이름은 영상 안에서 읽을 수 없도록 모자이크 처리합니다.
    const mosaicW=Math.min(Math.round(w*.28),right-textX);
    const mosaicH=Math.max(13,Math.round(h*.055));
    drawMosaicName(ctx,textX,y+pad+Math.round(h*.02),mosaicW,mosaicH);

    ctx.textAlign="left";
    ctx.textBaseline="alphabetic";
    ctx.fillStyle="#f4f4f5";
    ctx.font=`700 ${Math.max(23,Math.round(w*.029))}px "Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif`;
    const body=commentText(item).slice(0,220);
    const bodyY=y+pad+Math.round(h*.19);
    const bodyLines=wrapCanvasText(ctx,body,right-textX,3);
    const lineH=Math.max(34,Math.round(w*.04));
    bodyLines.forEach((line,i)=>ctx.fillText(line,textX,bodyY+i*lineH));

    ctx.fillStyle="#9b9ca1";
    ctx.font=`600 ${Math.max(18,Math.round(w*.021))}px "Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif`;
    const likes=commentLikes(item);
    ctx.fillText(`♡ ${likes?fmt(likes):""}    답글`,textX,y+h-pad);
  }

  function drawShortSocialOverlay(ctx,clip,canvas,elapsedSeconds=0){
    const design=clip?.design||{};
    const template=design.template||"댓글형";
    const comments=["댓글형","커뮤니티형"].includes(template)&&Array.isArray(clip?.comments)?clip.comments.filter(x=>commentText(x)):[];
    const avatars=Array.isArray(clip?.commentAvatarImages)?clip.commentAvatarImages:[];
    const title=String(clip?.thumbnailTitle||clip?.hook||"오늘의 핵심").slice(0,64);
    const subtitle=String(clip?.thumbnailSubtitle||"핵심 장면").slice(0,42);

    const landscape=canvas.width>canvas.height;
    const topH=Math.round(canvas.height*(landscape?.21:.115));
    ctx.fillStyle="#050506";
    ctx.fillRect(0,0,canvas.width,topH);

    ctx.textAlign="center";
    ctx.textBaseline="alphabetic";
    ctx.fillStyle="#fff";
    ctx.font=`900 ${Math.max(34,Math.round(canvas.width*.047))}px "Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif`;
    const titleLines=wrapCanvasText(ctx,title,canvas.width-Math.round(canvas.width*.10),landscape?1:2);
    const titleLineH=Math.max(50,Math.round(canvas.width*.057));
    const firstY=Math.round(topH*.38);
    titleLines.forEach((line,i)=>ctx.fillText(line,canvas.width/2,firstY+i*titleLineH));

    ctx.fillStyle=/^#[0-9a-f]{6}$/i.test(design.brandColor||"")?design.brandColor:"#55d9e6";
    ctx.font=`800 ${Math.max(24,Math.round(canvas.width*.03))}px "Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif`;
    ctx.fillText(subtitle,canvas.width/2,topH-Math.round(canvas.height*.018));

    // Show a single real comment, replacing it every four seconds of media time.
    if(comments.length){
      const videoRect=sourceVideoRect(canvas);
      const startY=landscape?Math.round(canvas.height*.28):videoRect.y+videoRect.height+Math.round(canvas.height*.035);
      const cardH=Math.round(canvas.height*(landscape?.52:.135));
      const side=Math.round(canvas.width*(landscape?.68:.035));
      const cardW=landscape?Math.round(canvas.width*.30):canvas.width-side*2;
      const index=activeCommentIndex(comments.length,elapsedSeconds);
      const phase=Math.max(0,elapsedSeconds)%COMMENT_INTERVAL_SECONDS;
      const alpha=elapsedSeconds<.2?1:Math.min(1,phase/.22,(COMMENT_INTERVAL_SECONDS-phase)/.22);
      ctx.save();ctx.globalAlpha=Math.max(0,alpha);ctx.translate(0,(1-alpha)*10);
      drawYoutubeCommentCard(ctx,comments[index],avatars[index]||null,side,startY,cardW,cardH);ctx.restore();
    }

    const wmY=canvas.height-Math.round(canvas.height*.022);
    ctx.textAlign="center";
    ctx.fillStyle="rgba(255,255,255,.86)";
    ctx.font=`800 ${Math.max(16,Math.round(canvas.width*.019))}px system-ui,sans-serif`;
    ctx.fillText("WEARON VIDEO",canvas.width/2,wmY);
  }

  function compositionSize(clip){return OUTPUT_SIZES[clip?.design?.aspectRatio]||OUTPUT_SIZES["9:16"];}

  function drawComposition(ctx,clip,canvas,frame,elapsed=0){
    ctx.fillStyle="#050506";ctx.fillRect(0,0,canvas.width,canvas.height);
    // Use the same 1080px design coordinates for thumbnails and downloaded videos.
    ctx.save();const scale=canvas.width/1080;ctx.scale(scale,scale);
    const logical={width:1080,height:canvas.height/scale};
    const rect=sourceVideoRect(logical);
    if(frame){
      const ratio=(frame.videoWidth||frame.width)/(frame.videoHeight||frame.height);
      let w=rect.width,h=w/ratio;
      if(h>rect.height){h=rect.height;w=h*ratio;}
      ctx.drawImage(frame,rect.x+(rect.width-w)/2,rect.y+(rect.height-h)/2,w,h);
    }else{
      ctx.fillStyle="#1b1c29";ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
      ctx.fillStyle="#a4a6bb";ctx.font="500 36px system-ui";ctx.textAlign="center";
      ctx.fillText("영상 영역",logical.width/2,rect.y+rect.height/2);
    }
    if(clip?.design?.template!=="미니멀") drawShortSocialOverlay(ctx,clip,logical,elapsed);
    if(clip?.design?.template==='커뮤니티형'){
      ctx.strokeStyle=clip.design.brandColor||'#7c5cff';ctx.lineWidth=5;ctx.strokeRect(12,rect.y-8,logical.width-24,rect.height+16);
    }
    const caption=(clip.captions||[]).find(c=>elapsed+Number(clip.aiGenerated?0:clip.start||0)>=c.start&&elapsed+Number(clip.aiGenerated?0:clip.start||0)<c.end);
    if(caption){ctx.font='700 30px system-ui';ctx.textAlign='center';ctx.fillStyle='#fff';ctx.strokeStyle='#000';ctx.lineWidth=6;const line=String(caption.text).slice(0,60);ctx.strokeText(line,logical.width/2,rect.y+rect.height-24,logical.width*.9);ctx.fillText(line,logical.width/2,rect.y+rect.height-24,logical.width*.9);}
    ctx.restore();
  }

  async function createCompositionPreview(clip,source="",layoutOnly=false){
    let objectUrl="",frame=null,avatars=[];
    try{
      let src=clip?.aiGenerated?clip.videoUrl:source;
      if(!layoutOnly&&clip?.sourceClip&&clip.remoteJobId&&clip.remoteAccessToken){
        const session=await getSession();
        const response=await fetch(`/api/ai/recreate?action=content&clipId=${encodeURIComponent(clip.remoteClipId||"")}&index=${Number(clip.remoteIndex||0)}&jobId=${encodeURIComponent(clip.remoteJobId)}&token=${encodeURIComponent(clip.remoteAccessToken)}`,{headers:{Authorization:`Bearer ${session?.access_token||""}`},signal:AbortSignal.timeout(45000)});
        if(!response.ok) throw new Error("미리보기용 영상을 불러오지 못했습니다.");
        objectUrl=URL.createObjectURL(await response.blob());src=objectUrl;
      }
      if(layoutOnly&&ytMeta?.id){
        const response=await fetch(`/api/youtube/thumbnail?id=${encodeURIComponent(ytMeta.id)}`);
        if(response.ok)frame=await createImageBitmap(await response.blob());
      }else if(layoutOnly&&fileUrl){frame=await getVideoFrameSource(fileUrl,rangeStart+1);}
      if(!layoutOnly){
        if(!src) throw new Error("완성된 영상이 필요합니다.");
        frame=await getVideoFrameSource(src,clip.aiGenerated?1:Number(clip.start||0)+1);
      }
      avatars=await loadCommentAvatarImages(clip.comments||[]);
      const canvas=document.createElement("canvas");
      [canvas.width,canvas.height]=compositionSize(clip);
      const renderClip={...clip,commentAvatarImages:avatars};
      if(layoutOnly&&["댓글형","커뮤니티형"].includes(clip.design?.template)) renderClip.comments=[{text:"댓글 영역",author:"작성자",likeCount:0}];
      drawComposition(canvas.getContext("2d"),renderClip,canvas,frame,1);
      const small=document.createElement("canvas");small.width=320;small.height=Math.round(canvas.height*320/canvas.width);
      small.getContext("2d").drawImage(canvas,0,0,small.width,small.height);
      return small.toDataURL("image/jpeg",.82);
    }finally{
      if(frame){frame.pause?.();frame.removeAttribute?.("src");frame.load?.();frame.close?.();}
      avatars.forEach(img=>img?.close?.());if(objectUrl)URL.revokeObjectURL(objectUrl);
    }
  }

  async function getVideoFrameSource(src,seekSeconds=1){
    const video=document.createElement("video");
    video.crossOrigin="anonymous";
    video.muted=true;
    video.playsInline=true;
    video.preload="auto";
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("영상 미리보기 시간 초과")),20000);
      video.onloadedmetadata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(new Error("영상 읽기 실패"));};video.src=src;
    });
    const target=Math.min(Math.max(0,seekSeconds),Math.max(0,(video.duration||seekSeconds)-.1));
    if(target>0){
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("대표 프레임 읽기 시간 초과")),10000);video.onseeked=()=>{clearTimeout(timer);resolve();};video.currentTime=target;});
    }
    return video;
  }

  async function downloadThumbnail(clip){
    let localObjectUrl="";
    let avatarImages=[];
    try{
      let thumbClip=clip;
      if(clip?.sourceClip && clip?.remoteJobId && clip?.remoteAccessToken){
        const session=await getSession();
        if(!session?.access_token) throw new Error("로그인이 만료되었습니다.");
        const res=await fetch(
          `/api/ai/recreate?action=content&clipId=${encodeURIComponent(clip.remoteClipId||"")}&index=${Number(clip.remoteIndex||0)}&jobId=${encodeURIComponent(clip.remoteJobId)}&token=${encodeURIComponent(clip.remoteAccessToken)}`,
          {headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"}
        );
        if(!res.ok) throw new Error("썸네일 원본을 불러오지 못했습니다.");
        const blob=await res.blob();
        localObjectUrl=URL.createObjectURL(blob);
        thumbClip={...clip,videoUrl:localObjectUrl};
      }

      avatarImages=await loadCommentAvatarImages(thumbClip?.comments||[]);
      thumbClip={...thumbClip,commentAvatarImages:avatarImages};

      const canvas=document.createElement("canvas");
      [canvas.width,canvas.height]=compositionSize(thumbClip);
      const ctx=canvas.getContext("2d");
      ctx.fillStyle="#050506";
      ctx.fillRect(0,0,canvas.width,canvas.height);

      const src=thumbClip?.aiGenerated ? thumbClip?.videoUrl : fileUrl;
      if(!src) throw new Error("완성된 영상이 필요합니다.");
      const frame=await getVideoFrameSource(src,thumbClip?.aiGenerated?1:(thumbClip?.start||0)+1);
      drawComposition(ctx,thumbClip,canvas,frame,1);
      frame.pause();frame.removeAttribute("src");frame.load();
      const href=canvas.toDataURL("image/png",1);
      const a=document.createElement("a");
      a.href=href;
      a.download=`WEARON_THUMBNAIL_${clip?.id||1}.png`;
      a.click();
      setToast("썸네일 PNG 다운로드를 시작했습니다.");
    }catch{
      setToast("썸네일 생성에 실패했습니다.");
    }finally{
      avatarImages.forEach(img=>img?.close?.());
      if(localObjectUrl) URL.revokeObjectURL(localObjectUrl);
    }
  }

  async function renderGeneratedClip(clip){
    if(!clip?.videoUrl) return setToast("완성된 쇼츠 영상이 없습니다.");
    if(!("MediaRecorder" in window)) return setToast("Chrome/Edge에서 다운로드해주세요.");

    let localObjectUrl="";
    let avatarImages=[];
    try{
      setRendering(true);
      setRenderProgress(0);
      setToast(`${clip?.design?.aspectRatio||"9:16"} 완성본을 렌더링하고 있습니다...`);

      let renderUrl=clip.videoUrl;
      if(clip?.sourceClip && clip?.remoteJobId && clip?.remoteAccessToken){
        const session=await getSession();
        if(!session?.access_token) throw new Error("로그인이 만료되었습니다.");
        const res=await fetch(
          `/api/ai/recreate?action=content&clipId=${encodeURIComponent(clip.remoteClipId||"")}&index=${Number(clip.remoteIndex||0)}&jobId=${encodeURIComponent(clip.remoteJobId)}&token=${encodeURIComponent(clip.remoteAccessToken)}`,
          {headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"}
        );
        if(!res.ok) throw new Error("렌더링용 원본을 불러오지 못했습니다.");
        const blob=await res.blob();
        localObjectUrl=URL.createObjectURL(blob);
        renderUrl=localObjectUrl;
      }

      avatarImages=await loadCommentAvatarImages(clip?.comments||[]);
      const renderClip={...clip,commentAvatarImages:avatarImages};

      const video=document.createElement("video");
      video.src=renderUrl;
      video.muted=false;
      video.playsInline=true;
      video.preload="auto";
      await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});

      // 최종 저장 파일은 고정 9:16, 내부 원본 영상은 16:9 프레임으로 유지합니다.
      const canvas=document.createElement("canvas");
      [canvas.width,canvas.height]=compositionSize(clip);
      const ctx=canvas.getContext("2d");
      const canvasStream=canvas.captureStream(30);

      let audioTracks=[];
      try{
        const srcStream=video.captureStream ? video.captureStream() : video.mozCaptureStream?.();
        if(srcStream) audioTracks=srcStream.getAudioTracks();
      }catch{}
      const outStream=new MediaStream([...canvasStream.getVideoTracks(),...audioTracks]);
      const mime=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"].find(x=>MediaRecorder.isTypeSupported(x))||"";
      const options=mime?{mimeType:mime,videoBitsPerSecond:10000000}:{videoBitsPerSecond:10000000};
      const rec=new MediaRecorder(outStream,options);
      const chunks=[];
      rec.ondataavailable=e=>{if(e.data?.size) chunks.push(e.data);};
      const done=new Promise(resolve=>rec.onstop=resolve);

      const duration=Math.max(.5,video.duration||clip.duration||12);
      const draw=()=>drawComposition(ctx,renderClip,canvas,video,video.currentTime);

      let raf=0;
      const frame=()=>{
        draw();
        if(!video.paused&&!video.ended) raf=requestAnimationFrame(frame);
      };

      rec.start(250);
      await video.play();
      frame();

      const tick=setInterval(()=>{
        const p=Math.min(100,(video.currentTime/duration)*100);
        setRenderProgress(p);
        if(video.ended||video.currentTime>=duration-.08){
          clearInterval(tick);
          cancelAnimationFrame(raf);
          video.pause();
          if(rec.state!=="inactive") rec.stop();
        }
      },120);

      await done;
      const blob=new Blob(chunks,{type:mime||"video/webm"});
      const href=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=href;
      a.download=`WEARON_SHORT_${clip?.id||1}_9x16.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(href),5000);
      setToast(`${clip?.design?.aspectRatio||"9:16"} 완성본 다운로드를 시작했습니다.`);
    }catch{
      setToast(`${clip?.design?.aspectRatio||"9:16"} 완성본 렌더링에 실패했습니다. Chrome/Edge에서 다시 시도해주세요.`);
    }finally{
      avatarImages.forEach(img=>img?.close?.());
      if(localObjectUrl) URL.revokeObjectURL(localObjectUrl);
      setRendering(false);
      setRenderProgress(0);
    }
  }

  async function downloadAdminTestVideo(clip){
    if(!("MediaRecorder" in window)) return setToast("Chrome/Edge에서 테스트 영상을 다운로드해주세요.");

    try{
      setRendering(true);
      setRenderProgress(0);

      const canvas=document.createElement("canvas");
      canvas.width=540;
      canvas.height=960;
      const ctx=canvas.getContext("2d");
      const stream=canvas.captureStream(30);
      const mime=["video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"].find(x=>MediaRecorder.isTypeSupported(x))||"";
      const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
      const chunks=[];
      rec.ondataavailable=e=>{if(e.data?.size) chunks.push(e.data);};
      const done=new Promise(resolve=>rec.onstop=resolve);

      let image=null;
      try{
        image=new Image();
        image.crossOrigin="anonymous";
        image.src="/images/%EC%82%BC%EC%83%89%20%EC%98%81%EC%83%81%20%ED%8C%A8%EB%84%90%20W%20%EB%A1%9C%EA%B3%A0.png";
        await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;});
      }catch{ image=null; }

      const durationMs=5000;
      const start=performance.now();
      rec.start(200);

      await new Promise(resolve=>{
        const draw=(now)=>{
          const elapsed=Math.min(durationMs,now-start);
          const p=elapsed/durationMs;
          const grad=ctx.createLinearGradient(0,0,540,960);
          grad.addColorStop(0,"#111827");
          grad.addColorStop(.5,"#312e81");
          grad.addColorStop(1,"#0f172a");
          ctx.fillStyle=grad;
          ctx.fillRect(0,0,540,960);

          if(image){
            ctx.save();
            ctx.globalAlpha=.28;
            const scale=Math.max(540/image.width,960/image.height);
            const w=image.width*scale,h=image.height*scale;
            ctx.drawImage(image,(540-w)/2,(960-h)/2,w,h);
            ctx.restore();
          }

          ctx.fillStyle="rgba(0,0,0,.45)";
          ctx.fillRect(24,42,492,118);
          ctx.fillStyle="#78e5cd";
          ctx.font="800 16px system-ui";
          ctx.textAlign="center";
          ctx.fillText("ADMIN FREE TEST · API COST ₩0",270,76);

          ctx.fillStyle="#fff";
          ctx.font="900 30px system-ui";
          const title=String(clip?.hook||"WEARON VIDEO 테스트").slice(0,22);
          ctx.fillText(title,270,126);

          const y=390+Math.sin(p*Math.PI*2)*12;
          ctx.fillStyle="rgba(255,255,255,.11)";
          ctx.beginPath();
          ctx.arc(270,y,118,0,Math.PI*2);
          ctx.fill();
          ctx.fillStyle="#fff";
          ctx.beginPath();
          ctx.moveTo(250,y-42);
          ctx.lineTo(250,y+42);
          ctx.lineTo(326,y);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle="rgba(0,0,0,.62)";
          ctx.fillRect(36,720,468,126);
          ctx.fillStyle="#fff";
          ctx.font="800 22px system-ui";
          ctx.fillText("WEARON VIDEO",270,766);
          ctx.fillStyle="#cbd5e1";
          ctx.font="600 16px system-ui";
          ctx.fillText("무료 관리자 테스트 영상",270,800);
          ctx.fillText("외부 클리핑 API를 호출하지 않습니다.",270,830);

          setRenderProgress(Math.round(p*100));
          if(elapsed<durationMs){
            requestAnimationFrame(draw);
          }else{
            rec.stop();
            resolve();
          }
        };
        requestAnimationFrame(draw);
      });

      await done;
      const blob=new Blob(chunks,{type:mime||"video/webm"});
      const href=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=href;
      a.download=`WEARON_ADMIN_TEST_${clip?.id||1}.webm`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(href),5000);
      setToast("실제 영상 파일(WebM) 테스트 다운로드를 시작했습니다.");
    }catch{
      setToast("테스트 영상 생성에 실패했습니다. Chrome/Edge에서 다시 시도해주세요.");
    }finally{
      setRendering(false);
      setRenderProgress(0);
    }
  }

  function downloadGeneratedClip(clip){
    if(clip?.testMode) return downloadAdminTestVideo(clip);
    return renderGeneratedClip(clip);
  }

  async function renderClip(clip){
    if(!fileUrl) return setToast("업로드한 원본 파일이 필요합니다.");
    if(!("MediaRecorder" in window)) return setToast("Chrome/Edge에서 렌더링해주세요.");

    try{
      setRendering(true); setRenderProgress(0);
      const avatarImages=await loadCommentAvatarImages(clip.comments||[]);
      clip={...clip,commentAvatarImages:avatarImages};
      const video=document.createElement("video");
      video.src=fileUrl; video.muted=false; video.playsInline=true;
      await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});

      const start=Math.min(clip.start,Math.max(0,video.duration-0.5));
      const dur=Math.min(clip.duration,Math.max(0.5,video.duration-start));
      video.currentTime=start;
      await new Promise(resolve=>{video.onseeked=resolve;});

      const canvas=document.createElement("canvas");
      [canvas.width,canvas.height]=compositionSize(clip);
      const ctx=canvas.getContext("2d");
      const canvasStream=canvas.captureStream(30);

      let audioTracks=[];
      try{
        const srcStream=video.captureStream ? video.captureStream() : video.mozCaptureStream?.();
        if(srcStream) audioTracks=srcStream.getAudioTracks();
      }catch{}

      const outStream=new MediaStream([...canvasStream.getVideoTracks(),...audioTracks]);
      const candidates=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"];
      const mime=candidates.find(x=>MediaRecorder.isTypeSupported(x))||"";
      const rec=new MediaRecorder(outStream,mime?{mimeType:mime}:undefined);
      const chunks=[];
      rec.ondataavailable=e=>{ if(e.data?.size) chunks.push(e.data); };
      const done=new Promise(resolve=>rec.onstop=resolve);

      let raf=0;
      const draw=()=>{
        drawComposition(ctx,clip,canvas,video,Math.max(0,video.currentTime-start));

        if(!video.paused && !video.ended) raf=requestAnimationFrame(draw);
      };

      rec.start(250);
      await video.play();
      draw();

      const endAt=start+dur;
      const tick=setInterval(()=>{
        setRenderProgress(Math.min(99,((video.currentTime-start)/dur)*100));
        if(video.currentTime>=endAt || video.ended){
          clearInterval(tick);
          cancelAnimationFrame(raf);
          video.pause();
          rec.stop();
        }
      },120);

      await done;
      setRenderProgress(100);
      const blob=new Blob(chunks,{type:mime||"video/webm"});
      const out=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=out;
      a.download=`WEARON_VIDEO_${clip.id}.webm`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(out),5000);
      setToast("9:16 쇼츠 파일 다운로드를 시작했습니다.");
    }catch{
      setToast("이 영상은 브라우저 렌더링에 실패했습니다. 다른 MP4 파일로 다시 시도해주세요.");
    }finally{
      if(localObjectUrl) URL.revokeObjectURL(localObjectUrl);
      setRendering(false);
    }
  }

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="brandMark">W</div><div><b>WEARON</b><span>VIDEO</span></div></div>
      <div className="usage"><small>라이브 연결 상태</small><b className={trendStatus==="live"?"ok":""}>{trendStatus==="live"?"YouTube API 연결됨":"YouTube API 키 연결 대기"}</b></div>
      <nav>{nav.map(([k,ic,label])=><button key={k} className={page===k?"active":""} onClick={()=>setPage(k)}><span>{ic}</span>{label}</button>)}</nav>
      <div className="accountBox">
        {user ? <>
          <small>로그인됨 · {isAdmin ? "ADMIN · 크레딧 무제한" : String(subscription?.plan||"free").toUpperCase()}</small>
          <b>{user.email}</b>
          {isAdmin && <a className="adminLink" href="/admin">관리자</a>}
          {isAdmin && <button className={adminTestMode?"adminTestToggle on":"adminTestToggle"} onClick={()=>{setAdminTestMode(v=>!v);setToast(adminTestMode?"관리자 테스트 모드를 껐습니다. 실제 API 비용이 발생할 수 있습니다.":"관리자 무료 테스트 모드를 켰습니다. 외부 클리핑 API 비용이 발생하지 않습니다.");}}>{adminTestMode?"무료 테스트 모드 ON":"실제 AI 모드"}</button>}
          <button onClick={logout}>로그아웃</button>
        </> : <>
          <small>WEARON 계정</small>
          <b>프로젝트 저장을 위해 로그인하세요.</b>
          <button onClick={()=>{setAuthMode("login");setAuthStep("form");setAuthModal(true);}}>로그인 / 회원가입</button>
        </>}
      </div>
      <button className="plan" onClick={()=>isAdmin?setToast("관리자 계정은 WEARON 크레딧 제한 없이 이용됩니다."):setPage("pricing")}>◆ {isAdmin ? "관리자 · 무제한" : `요금제 ${String(subscription?.plan||"free").toUpperCase()}`}</button>
    </aside>

    <main className="main">
      {page==="home" && <section className="page">
        {isAdmin && <div className={adminTestMode?"adminTestBanner":"adminTestBanner live"}><b>{adminTestMode?"관리자 무료 테스트 모드":"관리자 실제 AI 모드"}</b><span>{adminTestMode?"외부 클리핑 API를 호출하지 않아 비용이 0원입니다. 생성·결과·다운로드 흐름만 테스트합니다.":"OpusClip이 YouTube 전체 영상을 분석해 실제 쇼츠 후보를 생성합니다. 실행 시 API 사용량이 발생합니다."}</span><button onClick={()=>setAdminTestMode(v=>!v)}>{adminTestMode?"실제 AI로 전환":"무료 테스트로 전환"}</button></div>}
        <div className="topStats"><div><span>실시간 인기</span><b>{trendStatus==="live"?"자동 갱신":"API 연결 대기"}</b></div><div><span>프로젝트</span><b>{projects.length}</b></div></div>
        <div className="hero">
          <div className="eyebrow">AI SHORTS STUDIO</div>
          <h1>긴 영상의 핵심만,<br/><em>쇼츠로 빠르게.</em></h1>
          <p>YouTube 트렌드를 실시간으로 확인하고, 권리를 보유한 원본 영상을 9:16 쇼츠로 변환합니다.</p>

          <div className="heroVisual">
            <img src="/images/%EC%82%BC%EC%83%89%20%EC%98%81%EC%83%81%20%ED%8C%A8%EB%84%90%20W%20%EB%A1%9C%EA%B3%A0.png" alt="WEARON VIDEO" />
            <div className="heroVisualGlow" aria-hidden="true"></div>
          </div>

          <div className="tabs">
            <button className={sourceMode==="youtube"?"on":""} onClick={()=>setSourceMode("youtube")}>🔗 YouTube 링크</button>
            <button className={sourceMode==="upload"?"on":""} onClick={()=>setSourceMode("upload")}>⇧ 원본 파일 업로드</button>
          </div>

          <div className="sourceCard">
            <input ref={fileInput} type="file" accept="video/*" hidden onChange={e=>onFile(e.target.files?.[0])}/>
            {sourceMode==="youtube" ? <>
              <div className="urlRow"><span>↗</span><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="YouTube 영상 URL을 붙여 넣으세요"/><button onClick={inspectYoutube}>지금 변환하기</button></div>
              {ytMeta && <div className="ytMeta">
                <img src={ytMeta.thumbnail} alt=""/>
                <div><b>{ytMeta.title}</b><span>{ytMeta.channelTitle}{ytMeta.viewCount ? ` · 조회수 ${fmt(ytMeta.viewCount)}`:""}{ytMeta.duration ? ` · ${durationToText(ytMeta.duration)}`:""}</span></div>
                <button onClick={()=>fileInput.current?.click()}>{file ? "원본 연결됨 ✓" : "원본 파일 연결"}</button>
              </div>}
            </> : <>
              <label className="uploadBox" onClick={()=>fileInput.current?.click()}>
                <div className="uploadIcon">⇧</div>
                <div><b>{file ? file.name : "원본 영상 파일 선택"}</b><span>본인이 소유하거나 사용 허가를 받은 파일을 선택하세요.</span></div>
                <strong onClick={()=>fileInput.current?.click()}>파일 선택</strong>
              </label>
            </>}
            <small>YouTube 링크를 넣고 구간·템플릿·비율을 선택하면 해당 설정의 MP4를 만듭니다. 별도 원본 파일은 필요하지 않습니다.</small>
          </div>
        </div>

        {builderOpen && <section className="builder">
          <div className="builderHead">
            <div><small>SHORTS BUILDER</small><h2>분석 범위와 스타일을 선택하세요</h2><p>{sourceMode==="youtube"&&!file ? "OpusClip이 원본 영상에서 재밌고 반응이 좋은 장면을 자동으로 골라 최대 6개 쇼츠를 만듭니다." : "AI가 선택한 범위 안에서 실제 음성을 전사하고 쇼츠 후보를 만듭니다."}</p></div>
            <div className="builderStatus">{file ? "원본 연결됨" : "YouTube 링크 분석 완료 · 파일 불필요"}</div>
          </div>

          <div className="sourcePreview">
            <div className="sourceThumb">{ytMeta?.thumbnail ? <img src={ytMeta.thumbnail} alt=""/> : fileUrl ? <video src={fileUrl} muted/> : <span>WEARON VIDEO</span>}</div>
            <div><b>{ytMeta?.title || file?.name || "새 쇼츠 프로젝트"}</b><span>{ytMeta?.channelTitle || "업로드 원본"}{ytMeta?.duration ? ` · ${durationToText(ytMeta.duration)}` : fileDuration ? ` · ${clock(fileDuration)}` : ""}</span></div>
          </div>

          <div className="builderBlock">
            <div className="builderTitle"><div><b>사용할 영상 구간</b><span>양쪽 손잡이로 선택한 구간만 AI가 분석합니다.</span></div><strong>{clock(rangeStart)} → {clock(rangeEnd)}</strong></div>
            <div className="dualRange" style={{"--range-start":`${sourceSeconds?rangeStart/sourceSeconds*100:0}%`,"--range-end":`${sourceSeconds?rangeEnd/sourceSeconds*100:100}%`}}>
              <div className="rangeTrack"/>
              <input aria-label="분석 시작점" type="range" min="0" max={sourceSeconds||1} step="1" value={rangeStart} onChange={e=>setRangeStart(Math.max(0,Math.min(Number(e.target.value),rangeEnd-8)))}/>
              <input aria-label="분석 종료점" type="range" min="0" max={sourceSeconds||1} step="1" value={rangeEnd} onChange={e=>setRangeEnd(Math.min(sourceSeconds,Math.max(Number(e.target.value),rangeStart+8)))}/>
            </div>
            <div className="rangeInputs"><label>시작 (초)<input aria-label="시작 시간" type="number" min="0" max={rangeEnd-8} value={rangeStart} onChange={e=>setRangeStart(Math.max(0,Math.min(Number(e.target.value)||0,rangeEnd-8)))}/></label><label>종료 (초)<input aria-label="종료 시간" type="number" min={rangeStart+8} max={sourceSeconds} value={rangeEnd} onChange={e=>setRangeEnd(Math.min(sourceSeconds,Math.max(rangeStart+8,Number(e.target.value)||rangeStart+8)))}/></label></div>
            <p>선택 구간 길이: {clock(Math.max(0,rangeEnd-rangeStart))} / 전체 {clock(sourceSeconds)}</p>
            {quote&&<div className="creditQuote"><span>예상 쇼츠 <b>최대 {quote.clipCount}개</b></span><span>기본 분석 <b>{quote.base} 크레딧</b></span><span>템플릿 추가 <b>{quote.extra} 크레딧</b></span><strong>총 예상 {quote.total} 크레딧 {isAdmin?"(관리자 차감 면제)":""}</strong><small>1분 단위 올림 · 댓글형 1개당 +2 · 결과가 적으면 미생성 댓글형 크레딧 자동 환급</small>{creditBalance&&!isAdmin&&<small>현재 보유 {creditBalance.balance} 크레딧</small>}</div>}
          </div>

          <div className="builderBlock">
            <div className="builderTitle"><div><b>템플릿</b><span>자동자막 없이 후킹 제목·원본 영상·댓글 오버레이 구성을 선택합니다.</span></div></div>
            <div className="templateStrip">
              {[...templateData,["커뮤니티형","커뮤니티 카드"]].map(([name,desc])=><button key={name} className={selectedTemplate===name?"selected":""} onClick={()=>setSelectedTemplate(name)}><div className="miniTemplate">{presetPreviews[name]?<img src={presetPreviews[name]} alt={`${name} 렌더링 미리보기`}/>:<span>미리보기 준비 중</span>}</div><b>{name}</b></button>)}
            </div>
          </div>

          <div className="builderBlock builderOptions">
            <div><b>영상 비율</b><div className="ratioBtns">{Object.keys(OUTPUT_SIZES).map(r=><button key={r} className={aspectRatio===r?"selected":""} onClick={()=>setAspectRatio(r)}>{r}</button>)}</div></div>
            <div><b>브랜드 컬러</b><div className="colorRow">{["#ff6559","#ff8a65","#ffd05a","#54d8cf","#7c5cff","#4c84ff"].map(color=><button key={color} className={brandColor===color?"selected":""} style={{background:color}} onClick={()=>setBrandColor(color)} aria-label={color}/>)}</div></div>
          </div>

          <label className="rightsCheck"><input type="checkbox" checked={rightsConfirmed} onChange={e=>setRightsConfirmed(e.target.checked)}/><div><b>원본 영상 권리 확인</b><span>이 영상을 내가 소유하고 있거나 쇼츠 제작·편집 및 이용에 필요한 허가를 받았습니다.</span></div></label>

          {!file && sourceMode!=="youtube" && <button className="connectOriginal" onClick={()=>fileInput.current?.click()}>원본 파일 연결</button>}
          <button className="generateShorts" onClick={startProject}>{"선택 구간으로 쇼츠 생성하기"} <span>→</span></button>
        </section>}

        <section className="section">
          <div className="sectionHead"><div><small>RECENT WORK</small><h2>내 프로젝트</h2></div><button onClick={()=>setPage("projects")}>전체보기 →</button></div>
          <div className="projectGrid">
            {projects.slice(0,3).map(p=><article key={p.id} className="savedProjectCard"><button className="cover savedProjectCover" onClick={()=>openCloudProject(p)}>{p.thumbnail?<img src={p.thumbnail} alt={`${p.title} 완성 쇼츠`}/>:<span>WEARON VIDEO</span>}</button><h3>{p.title}</h3><span className="projectReady">● {p.status==="ready"?"완료":"처리 중"}</span><p>쇼츠 {p.clips}개</p><time>{p.createdAt}</time></article>)}
            {!projects.length&&<div className="empty">첫 쇼츠를 만들면 실제 결과 썸네일이 여기에 표시됩니다.</div>}
          </div>
        </section>
      </section>}

      {page==="popular" && <section className="page popularDiscoveryPage">
        <div className="popularHero">
          <div>
            <small>TREND DISCOVERY</small>
            <h1>지금 뜨는 영상을<br/><span>바로 쇼츠로.</span></h1>
            <p>대한민국 YouTube 실시간 인기 영상을 둘러보고, 원하는 영상을 바로 WEARON VIDEO 프로젝트로 가져오세요.</p>
          </div>
          <button className="popularRefresh" onClick={loadTrending}>↻ 인기 새로고침</button>
        </div>

        <div className="trendFilterBar">
          <div className="trendFilterTabs">
            {TREND_FILTERS.map(([id,label])=><button key={id} className={trendCategory===id?"active":""} onClick={()=>setTrendCategory(id)}>{label}</button>)}
          </div>
          <div className="trendLiveBadge"><i/> 대한민국 · 5분 자동 갱신</div>
        </div>

        {trendStatus==="key" && <div className="notice"><b>YouTube API 키만 연결하면 실시간 데이터가 시작됩니다.</b><span>Vercel 환경 변수에 <code>YOUTUBE_API_KEY</code>를 추가하면 이 화면이 자동으로 실제 인기 영상으로 바뀝니다.</span></div>}
        {trendStatus==="loading" && <div className="popularLoading"><i/><b>실시간 인기 영상을 불러오는 중</b><span>최신 YouTube 데이터를 정리하고 있습니다.</span></div>}

        <div className="popularGrid">
          {trending.filter(v=>trendMatches(v,trendCategory)).map(v=><article className="popularCard" key={v.id}>
            <button className="popularThumb" onClick={()=>void startFromTrending(v)}>
              <img src={v.thumbnail} alt=""/>
              <strong>#{v.rank}</strong>
              <span>{durationToText(v.duration)}</span>
              <em>쇼츠 만들기 →</em>
            </button>
            <div className="popularCardBody">
              <small>{v.channelTitle}</small>
              <h3>{v.title}</h3>
              <div className="popularMeta">
                <span>조회수 {fmt(v.viewCount)}</span>
                <span>좋아요 {fmt(v.likeCount)}</span>
              </div>
              <div className="popularActions">
                <button onClick={()=>void startFromTrending(v)}>이 영상으로 시작</button>
                <a href={v.url} target="_blank" rel="noreferrer">YouTube ↗</a>
              </div>
            </div>
          </article>)}
        </div>
        {trendStatus==="live" && !trending.filter(v=>trendMatches(v,trendCategory)).length && <div className="empty">현재 이 카테고리에 표시할 인기 영상이 없습니다.</div>}
      </section>}

      {page==="projects" && <section className="page">
        <div className="pageHead"><div><small>WORKSPACE</small><h1>내 프로젝트</h1><p>{user ? "내 계정에 저장된 프로젝트입니다." : "로그인하면 프로젝트를 계정에 저장할 수 있습니다."}</p></div><button onClick={()=>setPage("home")}>＋ 새 프로젝트</button></div>
        <div className="projectList">
          {pendingYoutubeJob&&<article className="processingProject">
            <div className="miniCover processingCover">W</div>
            <div className="processingProjectInfo">
              <h3>{pendingYoutubeJob?.meta?.title||"YouTube 자동 쇼츠"}</h3>
              <p>{pendingYoutubeJob?.message||"AI가 전체 영상을 분석하고 있습니다."}</p>
              <div className="projectProgress"><span style={{width:`${Math.max(8,Math.min(96,Number(pendingYoutubeJob?.progress||12)))}%`}}/></div>
              {pendingYoutubeJob?.error&&<small>{pendingYoutubeJob.error}</small>}
            </div>
            <button onClick={()=>{setPage("analysis");void watchYoutubeJob(pendingYoutubeJob,{resume:true});}}>진행 보기</button>
          </article>}
          {projects.length ? projects.map(p=><article key={p.id}><div className="miniCover savedProjectCover">{p.thumbnail?<img src={p.thumbnail} alt={`${p.title} 완성 쇼츠`}/>:<span>WEARON VIDEO</span>}</div><div className="savedProjectInfo"><h3>{p.title}</h3><span className="projectReady">● {p.status==="ready"?"완료":"처리 중"}</span><p>쇼츠 {p.clips}개</p><time>{p.createdAt}</time></div><button disabled={!!openingProject} onClick={()=>openCloudProject(p)}>{openingProject===p.id?"불러오는 중":"열기"}</button></article>) : !pendingYoutubeJob&&<div className="empty">아직 프로젝트가 없습니다.</div>}
        </div>
      </section>}

      {page==="templates" && <section className="page">
        <div className="pageHead"><div><small>MY STYLES</small><h1>내 템플릿</h1><p>저장한 디자인을 다음 쇼츠에도 바로 적용하세요.</p></div></div>
        <form className="templateCreator" onSubmit={e=>{e.preventDefault();void saveMyTemplate();}}>
          <div className="templateDraft">{templateDraftPreview&&<img src={templateDraftPreview} alt="현재 템플릿 레이아웃 미리보기"/>}<small>현재 설정 미리보기</small></div>
          <div className="templateFields"><h2>새 템플릿 만들기</h2>
            <label>템플릿 이름<input value={templateName} onChange={e=>setTemplateName(e.target.value)} maxLength={80} placeholder="내 댓글형 템플릿" required/></label>
            <label>템플릿 유형<select value={selectedTemplate} onChange={e=>setSelectedTemplate(e.target.value)}>{[...templateData.map(x=>x[0]),"커뮤니티형"].map(n=><option key={n}>{n}</option>)}</select></label>
            <label>지원 비율<select value={aspectRatio} onChange={e=>setAspectRatio(e.target.value)}>{Object.keys(OUTPUT_SIZES).map(n=><option key={n}>{n}</option>)}</select></label>
            <label>브랜드 컬러<input type="color" value={brandColor} onChange={e=>setBrandColor(e.target.value)}/></label>
            <p>열어둔 완성 영상이 있으면 실제 장면으로, 없으면 현재 레이아웃으로 저장합니다.</p>
            <button className="primary" disabled={templateBusy}>{templateBusy?"미리보기 저장 중…":"내 템플릿에 저장"}</button>
          </div>
        </form>
        <div className="templates savedTemplates">{myTemplates.map(t=><article key={t.id}><div className="templatePreview savedTemplatePreview"><img src={t.preview_data} alt={`${t.name} 디자인 미리보기`}/></div><h3>{t.name}</h3><p>{t.design_settings?.aspectRatio||"9:16"} · {t.design_settings?.template||"댓글형"}</p><button onClick={()=>applyMyTemplate(t)}>이 템플릿 사용</button></article>)}</div>
        {!myTemplates.length&&<div className="empty">아직 저장한 템플릿이 없습니다. 위에서 첫 디자인을 저장해보세요.</div>}
      </section>}

      {page==="saved" && <section className="page center"><div className="emptyCard"><b>♡</b><h2>저장된 영상</h2><p>실시간 인기에서 저장한 영상이 표시될 영역입니다.</p><button onClick={()=>setPage("popular")}>실시간 인기 보기</button></div></section>}

      {page==="channels" && <section className="page">
        <div className="pageHead"><div><small>CONNECTIONS</small><h1>채널 연동</h1><p>배포 후 OAuth 연동을 붙일 수 있도록 UI를 준비했습니다.</p></div></div>
        <div className="channels">{[["▶","YouTube","쇼츠 업로드/채널 분석"],["◎","Instagram","릴스 게시"],["♪","TikTok","숏폼 게시"]].map(x=><article key={x[1]}><div>{x[0]}</div><section><b>{x[1]}</b><span>{x[2]}</span></section><button onClick={()=>setToast("OAuth 앱 설정 후 활성화됩니다.")}>연동하기</button></article>)}</div>
      </section>}

      {page==="pricing" && <section className="page pricingPage">
        <div className="pricingPageHero">
          <small>WEARON VIDEO PLANS</small>
          <h1>필요한 만큼 선택하세요.</h1>
          <p>30일 이용권 크레딧을 넉넉하게 조정하고, 활성 이용자를 위한 90일 얼리버드 추가 크레딧팩을 함께 준비했습니다.</p>
          <div className="pricingTerm"><span>이용기간</span><button className="active">30일 이용권</button></div>
        </div>

        <aside className="paymentActivationNotice" aria-label="결제 및 이용권 적용 안내">
          <div className="paymentActivationNoticeIcon">i</div>
          <div>
            <strong>결제 및 이용권 적용 안내</strong>
            <p>현재 결제는 계좌이체 입금 확인 후 처리됩니다. 입금이 확인되면 크레딧 충전 및 회원 이용권 변경이 순차적으로 반영되며, 처리 상황에 따라 적용까지 다소 시간이 소요될 수 있습니다.</p>
            <small>입금 후 즉시 반영되지 않더라도 중복 결제하지 마시고, 잠시 후 결제 상태를 다시 확인해 주세요.</small>
          </div>
        </aside>

        <div className="pricingPageGrid">
          {["starter","pro","business"].map(id=>{
            const plan=WEARON_PLANS[id];
            const current=subscription?.plan===id && subscription?.status==="active";
            return <article key={id} className={`pricingPlanCard ${id==="pro"?"best":id==="business"?"business":""}`}>
              {id==="pro" && <span className="pricingBadge hot">가장 합리적</span>}
              {id==="business" && <span className="pricingBadge purple">대량 제작</span>}
              <div className="pricingPlanTop">
                <small>{plan.name}</small>
                <h2>{id==="starter"?"스타터 패키지":id==="pro"?"프로 패키지":"비즈니스 패키지"}</h2>
                <p>{plan.description}</p>
              </div>
              <div className="pricingPrice"><strong>₩{plan.price.toLocaleString("ko-KR")}</strong><span>/30일</span></div>
              <ul>
                <li><b>{plan.credits} 크레딧</b> 제공</li>
                <li>AI 하이라이트 분석·쇼츠 제작</li>
                <li>프로젝트 클라우드 저장</li>
                <li>템플릿·비율·브랜드 컬러 적용</li>
                <li>완성본 미리보기·다운로드</li>
              </ul>
              <button disabled={current||checkoutBusy} onClick={()=>openCheckout(id)}>
                {current?"현재 이용 중":checkoutBusy?"준비 중...":`${id==="starter"?"스타터":id==="pro"?"프로":"비즈니스"} 이용권 시작하기`}
              </button>
            </article>
          })}
        </div>

        <div className="pricingCurrent">현재 플랜 <b>{String(subscription?.plan||"free").toUpperCase()}</b>{subscription?.current_period_end && <> · 이용기간 ~ {new Date(subscription.current_period_end).toLocaleDateString("ko-KR")}</>}</div>

        <section className="earlyBirdSection">
          <div className="earlyBirdHead">
            <small>LIMITED OFFER</small>
            <h2>얼리버드 특가 할인</h2>
            <p>계정당 한 번만 구매할 수 있는 90일 추가 크레딧팩입니다.</p>
          </div>
          <div className="earlyBirdGrid">
            {Object.values(EARLY_BIRD_PACKS).map((pack,index)=><article key={pack.id} className={`earlyBirdCard ${index===1?"featured":index===2?"purple":""}`}>
              <span className="earlyBirdDiscount">{pack.discount}% 할인</span>
              <small>얼리버드</small>
              <h3>{pack.credits.toLocaleString("ko-KR")} 크레딧</h3>
              <p>기본 분석 최대 {pack.credits.toLocaleString("ko-KR")}분 상당</p>
              <del>₩{pack.listPrice.toLocaleString("ko-KR")}</del>
              <strong>₩{pack.price.toLocaleString("ko-KR")}</strong>
              <button
                disabled={checkoutBusy||!activePaidPlan}
                onClick={()=>openCheckout(pack.id)}
              >
                {!activePaidPlan?"활성 이용권 필요":checkoutBusy?"준비 중...":"구매"}
              </button>
            </article>)}
          </div>
          <div className="earlyBirdNotice">
            활성 유료 이용권 보유자만 구매 가능 · 상품별이 아닌 계정당 1회 · 구매일로부터 90일 유효 · 월 이용권 크레딧과 함께 사용
          </div>
        </section>

        <section className="strategyGuideSection">
          <div className="strategyGuideHead">
            <div><small>WEARON STRATEGY</small><h2>숏폼 전략 가이드</h2><p>제작만 하고 끝내지 않도록, 조회수·후킹·운영·저작권까지 실전에 필요한 내용을 정리했습니다.</p></div>
            <button onClick={()=>setPage("guide")}>전체 가이드 보기 →</button>
          </div>
          <div className="strategyGuideRail">
            {strategyGuides.map(g=><article className="strategyGuideCard" key={g.id}>
              <div className="strategyGuideCover">
                <img src={g.image} alt="" loading="lazy"/>
                <div className="strategyGuideShade"/>
                <small>{g.tag}</small>
                <b>{g.title}</b>
              </div>
              <div className="strategyGuideCopy">
                <span>{g.id}</span>
                <p>{g.desc}</p>
                <button onClick={()=>{setPage("guide");setToast(`${g.title} 가이드를 확인해보세요.`);}}>미리보기</button>
              </div>
            </article>)}
          </div>
        </section>
      </section>}

      {page==="guide" && <section className="page guideLibraryPage">
        <div className="pageHead">
          <div><small>WEARON STRATEGY</small><h1>숏폼 전략 가이드</h1><p>WEARON VIDEO로 만든 쇼츠를 실제 조회수와 운영으로 연결하기 위한 실전 가이드입니다.</p></div>
          <button onClick={()=>setPage("pricing")}>요금제 보기</button>
        </div>
        <div className="guideLibraryGrid">
          {strategyGuides.map(g=><article className="guideLibraryCard" key={g.id}>
            <div className="guideLibraryImage"><img src={g.image} alt="" loading="lazy"/><span>{g.tag}</span></div>
            <div><small>GUIDE {g.id}</small><h3>{g.title}</h3><p>{g.desc}</p><button onClick={()=>setToast(`${g.title} 핵심 내용을 준비했습니다.`)}>핵심 내용 보기</button></div>
          </article>)}
        </div>
        <section className="guideQuickStart">
          <div><small>WEARON VIDEO QUICK START</small><h2>실전 제작 순서</h2><p>전략을 확인한 뒤 아래 순서대로 바로 제작하면 됩니다.</p></div>
          <div className="guide">{[
            ["01","YouTube 링크 입력","긴 YouTube 원본 링크를 넣고 영상 정보를 불러옵니다."],
            ["02","분석 구간 선택","원본에서 사용할 시작·종료 지점을 직접 정하고 AI가 강한 구간을 찾게 합니다."],
            ["03","쇼츠 자동 생성","선택한 템플릿과 비율로 최대 6개의 쇼츠 후보를 자동 생성합니다."],
            ["04","미리보기와 다운로드","완성 결과를 확인한 뒤 필요한 쇼츠만 고화질 MP4로 저장합니다."]
          ].map(x=><article key={x[0]}><em>{x[0]}</em><h3>{x[1]}</h3><p>{x[2]}</p></article>)}</div>
        </section>
      </section>}

      {page==="analysis" && <section className="page analysis easyProcessingPage">
        <div className="easyProcessingTop">
          <b>WEARON VIDEO <span>AI SHORTS STUDIO</span></b>
          <button disabled={!pendingYoutubeJob?.readyClipCount} onClick={()=>pendingYoutubeJob?.readyClipCount&&setPage("projects")}>바로 결과 보기</button>
        </div>
        <div className={`bar easyProcessingBar ${analysis<100?"working":""}`}><span style={{width:`${Math.max(10,analysis)}%`}}/></div>
        <div className="easyProcessingBody">
          <div className="easyProcessingPhone">
            {pendingYoutubeJob?.previewUrl
              ? <video src={pendingYoutubeJob.previewUrl} muted autoPlay loop playsInline/>
              : ytMeta?.thumbnail
                ? <img src={ytMeta.thumbnail} alt="원본 영상"/>
                : <div className="easyProcessingPlaceholder">W</div>}
            {analysis<100&&<><div className="easyProcessingScan"/><div className="easyProcessingPreviewBadge"><i/> AI가 쇼츠를 만드는 중</div></>}
          </div>
          <div className="easyProcessingInfo">
            <div className="easyProcessingCount"><span>SHORT {String(Math.max(1,Number(pendingYoutubeJob?.readyClipCount||1))).padStart(2,"0")}</span><b>{Math.min(6,Number(pendingYoutubeJob?.readyClipCount||0))}/6 준비</b></div>
            <h1>{pendingYoutubeJob?.previewTitle||ytMeta?.title||"원본 영상에서 핵심 장면을 찾는 중"}</h1>
            <p>{analysisMsg}</p>
            <div className="easyProcessingSteps">
              {[
                ["원본 준비",12],
                ["AI 장면 선정",30],
                ["쇼츠 렌더",55],
                ["템플릿 적용",78],
                ["결과 준비",94]
              ].map(([label,point])=><div key={label} className={analysis>=point?"done":analysis>=point-20?"active":""}><i>{analysis>=point?"✓":"•"}</i><span>{label}</span></div>)}
            </div>
            <div className="easyProcessingHighlight"><b>✦ AI 하이라이트</b><span>영상 품질은 그대로 유지한 채 원본 분석 → 핵심 장면 선택 → 쇼츠 렌더 → 댓글 오버레이 순서로 자동 처리합니다.</span></div>
            <div className="easyProcessingStatus">
              <strong>{pendingYoutubeJob?.readyClipCount ? `쇼츠 ${Math.min(6,Number(pendingYoutubeJob.readyClipCount))}/6 준비됨` : "AI 작업 진행 중"}</strong>
              <span>{pendingYoutubeJob?.createdAt ? `${clock(Math.max(0,(analysisTick-Number(pendingYoutubeJob.createdAt))/1000))} 경과` : "처리 중"} · 같은 단계에서도 내부 작업은 계속 진행됩니다.</span>
            </div>
            {pendingYoutubeJob&&<button className="backgroundJobBtn" onClick={()=>setPage("projects")}>백그라운드로 보내기</button>}
          </div>
        </div>
      </section>}

      {page==="results" && <section className="page easyProjectPage">
        <div className="easyProjectTop">
          <div>
            <button className="easyBack" onClick={()=>setPage("home")}>← 프로젝트</button>
            <h1>{ytMeta?.title || file?.name || "쇼츠 프로젝트"} <small>쇼츠 {results.length}개</small></h1>
          </div>
        </div>

        {pendingYoutubeJob&&<div className="liveResultsBanner">
          <div>
            <b>쇼츠 {Math.min(6,Number(pendingYoutubeJob?.readyClipCount||results.length||0))}/6개 준비됨</b>
            <span>{pendingYoutubeJob?.message||"나머지 쇼츠를 뒤에서 계속 생성하고 있습니다."}</span>
          </div>
          <div className="liveResultsProgress"><span style={{width:`${Math.max(8,Math.min(98,Number(pendingYoutubeJob?.progress||82)))}%`}}/></div>
        </div>}

        <div className="generationStages"><b>쇼츠 생성 중 {results.filter(c=>c.outputState==='completed').length} / {results.length||pendingYoutubeJob?.quote?.clipCount||6}</b><progress max="100" value={results.length?results.reduce((n,c)=>n+(c.outputState==='completed'?100:c.outputProgress||0),0)/results.length:0}/><span>{results.length?Math.round(results.reduce((n,c)=>n+(c.outputState==='completed'?100:c.outputProgress||0),0)/results.length):0}%</span><p>분석 → 장면 선택 → 제목 생성 → 자막(원본/전사 제공 시) → 댓글 구성 → 렌더링 → 완료</p><div>{results.map(c=><span key={c.id}>SHORT {String(c.id).padStart(2,'0')} · {c.outputState==='completed'?'완료':c.outputState==='error'?'실패':c.outputState==='rendering'?`생성 중 ${c.outputProgress}%`:'대기'}</span>)}</div></div>
        <div className="easyResultList">
          {results.length ? results.map(c=>{
            const comments=Array.isArray(c.comments)?c.comments.filter(x=>commentText(x)):[];
            const firstComment=comments[0]||null;
            const mediaSrc=c.aiGenerated?c.videoUrl:fileUrl;
            return <article className="easyResultItem" key={c.remoteClipId||c.id}>
              <h2><em>#{c.id}</em> {c.hook}</h2>
              <div className="easyResultBody">
                <div className="easyPreviewCol">
                  <div className="finalPreview" style={{aspectRatio:(c.design?.aspectRatio||'9:16').replace(':','/')}}>
                    {c.finalVideoUrl?<video src={c.finalVideoUrl} poster={c.thumbnail} controls playsInline preload="metadata"/>:c.thumbnail?<img src={c.thumbnail} alt="완성 영상"/>:<div className="clipMediaLoading"><b>{c.outputState==='error'?'영상 생성 실패':c.outputState==='rendering'?`렌더링 ${c.outputProgress||0}%`:'렌더링 대기'}</b><span>{c.outputError||'선택한 템플릿과 비율을 적용하고 있습니다.'}</span></div>}
                  </div>
                  <div className="easyPreviewActions finalActions">
                    <button disabled={!c.dbClipId||c.outputState==='rendering'} onClick={()=>setEditing({...c,design:{...c.design}})}>편집하기</button>
                    <button disabled={c.outputState!=='completed'} className="primary" onClick={()=>downloadFinal(c)}>다운로드</button>
                  </div>
                </div>

                <div className="easyDetailCol">
                  <div className="easyMetaLine">
                    <span>{c.sourceClip?"원본 영상 자동 컷":c.aiGenerated?"AI 처리 영상":"원본 영상 타임라인"}</span>
                    <strong>{c.sourceClip&&c.start>0?`◉ ${clock(c.start)} → ${clock(c.start+c.duration)}`:`약 ${Math.round(c.duration||12)}초`}</strong>
                  </div>
                  <div className="easyScore">바이럴 점수 <b>{c.score||90}/100</b></div>
                  <div className="easyAiBox"><b>✦ AI 하이라이트</b><p>{c.reason||"AI가 전체 영상에서 쇼츠용 핵심 장면을 골랐습니다."}</p></div>
                  <div className="easyScriptBox"><b>장면 정보</b><p>{c.transcript||c.script||"원본 영상에서 자동으로 선택된 핵심 구간입니다."}</p></div>
                  <div className="autoCommentsBox">
                    <div className="autoCommentsHead"><b>실제 YouTube 댓글</b><span>실제 공개 댓글을 캡처형 카드로 표시 · 작성자 이름 모자이크</span></div>
                    {comments.length
                      ? comments.slice(0,3).map((comment,index)=><div className="autoCommentRow" key={index}><span>Y</span><p><b className="maskedCommentAuthor">{commentAuthor(comment)}</b><br/>{commentText(comment)}</p></div>)
                      : <div className="autoCommentRow"><span>Y</span><p>공개 댓글을 불러오지 못했거나 댓글이 비활성화된 영상입니다.</p></div>}
                  </div>
                  <div className="thumbnailInfo">
                    <b>자동 썸네일</b>
                    <span>검정 후킹 제목 + 원본 핵심 장면 + 실제 YouTube 댓글 카드 구성으로 PNG가 생성됩니다.</span>
                  </div>
                  {c.testMode&&<div className="easyTestNote">관리자 무료 테스트 · API 비용 0원</div>}
                </div>
              </div>
            </article>
          }) : <div className="empty">먼저 YouTube 링크 또는 원본 영상을 넣어 프로젝트를 생성해주세요.</div>}
        </div>
      </section>}
    </main>

    {editing&&<div className="modal"><form className="modalCard templateFields clipEditor" onSubmit={e=>{e.preventDefault();saveClipEdits();}}><button type="button" className="x" onClick={()=>setEditing(null)}>✕</button><h2>쇼츠 편집</h2><label>후킹 제목<input value={editing.hook} maxLength={100} onChange={e=>setEditing({...editing,hook:e.target.value,thumbnailTitle:e.target.value})}/></label><label>템플릿<select value={editing.design?.template||'댓글형'} onChange={e=>setEditing({...editing,design:{...editing.design,template:e.target.value}})}>{[...templateData.map(x=>x[0]),'커뮤니티형'].map(t=><option key={t}>{t}</option>)}</select></label><label>영상 비율<select value={editing.design?.aspectRatio||'9:16'} onChange={e=>setEditing({...editing,design:{...editing.design,aspectRatio:e.target.value}})}>{Object.keys(OUTPUT_SIZES).map(r=><option key={r}>{r}</option>)}</select></label><label>브랜드 컬러<input type="color" value={editing.design?.brandColor||'#7c5cff'} onChange={e=>setEditing({...editing,design:{...editing.design,brandColor:e.target.value}})}/></label><button type="button" onClick={()=>{setSelectedTemplate(editing.design?.template||'댓글형');setAspectRatio(editing.design?.aspectRatio||'9:16');setBrandColor(editing.design?.brandColor||'#7c5cff');setTemplateName(`${editing.design?.template||'댓글형'} 템플릿`);setEditing(null);setPage('templates');}}>내 템플릿으로 저장</button><button className="primary">수정 저장 · MP4 다시 생성</button></form></div>}

    {authModal && <div className="modal" onMouseDown={e=>{if(e.target===e.currentTarget)setAuthModal(false)}}>
      <div className="modalCard authModal">
        <button className="x" onClick={()=>setAuthModal(false)}>✕</button>
        <div className="authBrand"><div className="brandMark">W</div><div><b>WEARON VIDEO</b><span>{authStep==="verify"?"이메일 인증":authMode==="login"?"계정에 로그인":"새 계정 만들기"}</span></div></div>

        {authStep==="verify" ? <>
          <div className="verifyCopy">
            <b>이메일 인증번호를 입력해주세요</b>
            <p><strong>{authEmail}</strong> 주소로 보낸 인증번호를 그대로 입력하면 회원가입이 완료됩니다.</p>
          </div>
          <form onSubmit={verifyCode}>
            <label>인증번호
              <input className="otpInput" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={authCode} onChange={e=>setAuthCode(e.target.value.replace(/\D/g,"").slice(0,10))} placeholder="인증번호 입력" autoFocus/>
            </label>
            <button className="primary" disabled={authBusy}>{authBusy?"확인 중...":"인증하고 가입 완료"}</button>
          </form>
          <button className="authResend" onClick={resendConfirmation} disabled={authBusy}>인증번호 다시 보내기</button>
          <button className="authSwitch" onClick={()=>{setAuthStep("form");setAuthMode("signup");setAuthCode("");}}>이메일 다시 입력하기</button>
          <p>인증번호는 일정 시간이 지나면 만료됩니다. 재전송은 보안상 잠시 기다린 뒤 다시 요청할 수 있습니다.</p>
        </> : <>
          <form onSubmit={submitAuth}>
            {authMode==="signup" && <label>이름<input value={authName} onChange={e=>setAuthName(e.target.value)} placeholder="이름"/></label>}
            <label>이메일<input type="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="name@example.com" autoComplete="email"/></label>
            <label>비밀번호<input type="password" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} placeholder="6자 이상" autoComplete={authMode==="login"?"current-password":"new-password"}/></label>
            <button className="primary" disabled={authBusy}>{authBusy?"처리 중...":authMode==="login"?"로그인":"회원가입"}</button>
          </form>
          <button className="authSwitch" onClick={()=>{setAuthMode(authMode==="login"?"signup":"login");setAuthStep("form");}}>
            {authMode==="login"?"계정이 없나요? 회원가입":"이미 계정이 있나요? 로그인"}
          </button>
          <p>{authMode==="signup"?"회원가입 시 이메일로 인증번호를 보내고, 인증 완료 후 가입됩니다.":"가입한 이메일과 비밀번호로 로그인하세요."}</p>
        </>}
      </div>
    </div>}

    {preview && <div className="modal" onMouseDown={e=>{if(e.target===e.currentTarget)setPreview(null)}}>
      <div className="modalCard previewModal"><button className="x" onClick={()=>setPreview(null)}>✕</button>
        <div className={`phone ${preview.sourceClip?"sourceClipPhone":""}`}>
          {preview.testMode&&preview.aiGenerated
            ? <img src={preview.previewImage} alt="관리자 무료 테스트"/>
            : <video key={preview.remoteClipId||preview.id} src={preview.aiGenerated?preview.videoUrl:fileUrl} controls autoPlay playsInline
                onLoadedMetadata={e=>{setPreviewElapsed(0);if(!preview.aiGenerated)e.currentTarget.currentTime=Math.min(preview.start,e.currentTarget.duration||preview.start)}}
                onTimeUpdate={e=>setPreviewElapsed(Math.max(0,e.currentTarget.currentTime-(preview.aiGenerated?0:Number(preview.start||0))))}
                onSeeked={e=>setPreviewElapsed(Math.max(0,e.currentTarget.currentTime-(preview.aiGenerated?0:Number(preview.start||0))))}/>}
          <div className="hook">{preview.hook}</div>
          {preview.sourceClip&&Array.isArray(preview.comments)&&preview.comments.length>0&&<div className="modalCommentsStack">
            {preview.comments.filter(x=>commentText(x)).filter((_,index,items)=>index===activeCommentIndex(items.length,previewElapsed)).map((comment,index)=><div className="modalCommentCard" key={index}>
              {typeof comment!=="string"&&comment?.avatar
                ? <img className="youtubeCommentAvatar" src={comment.avatar} alt=""/>
                : <span className="aiCommentAvatar">Y</span>}
              <div>
                <small className="maskedCommentAuthor">{commentAuthor(comment)}</small>
                <b>{commentText(comment)}</b>
                <em>♡ {commentLikes(comment)?fmt(commentLikes(comment)):""} · 답글</em>
              </div>
            </div>)}
          </div>}
          <div className="watermark">WEARON VIDEO</div>
          {preview.testMode&&<div className="previewTestBadge">API COST ₩0</div>}
        </div>
        <div className="previewCopy"><small>{preview.testMode?"ADMIN FREE TEST":preview.sourceClip?"YOUTUBE AUTO CLIP":preview.aiGenerated?"AI SHORT":"SHORT PREVIEW"}</small><h2>#{preview.id} {preview.hook}</h2><p>{preview.testMode?"API를 호출하지 않는 관리자 무료 테스트 결과입니다. 실제 자동 컷은 테스트 모드를 끄고 실행하세요.":preview.sourceClip?"최종 저장본은 9:16, 원본 영상은 16:9로 유지하고 실제 YouTube 댓글은 작성자 이름만 모자이크해 한 개씩 4초마다 교체합니다.":preview.aiGenerated?"AI 처리 영상입니다.":"AI가 실제 음성을 전사하고 선택한 구간입니다."}</p><button className="primary fastPreviewDownload" onClick={()=>requestFastDownload(preview)}>↓ {preview.testMode?"테스트 영상 다운로드":"9:16 완성본 저장"}</button><button className="commentPreviewDownload" onClick={()=>requestDownload(preview)}>💬 댓글 포함 저장</button><button onClick={()=>isAdmin?setToast("관리자 계정은 WEARON 크레딧 제한 없이 이용됩니다."):setPage("pricing")}>✎ PRO 편집기 보기</button></div>
      </div>
    </div>}

    {downloadPaywall && !isAdmin && <div className="downloadPaywall" onMouseDown={e=>{if(e.target===e.currentTarget)setDownloadPaywall(false)}}>
      <div className="downloadPaywallCard">
        <div className="downloadPaywallIcon">↓</div>
        <h2>다운로드 기능을 이용하려면<br/>활성 유료 이용권이 필요합니다.</h2>
        <p>프로젝트와 미리보기는 그대로 유지됩니다.<br/>이용권을 선택하면 바로 다운로드할 수 있습니다.</p>
        <button className="downloadPaywallPrimary" onClick={openPlansFromPaywall}>요금제 보기</button>
        <button className="downloadPaywallSecondary" onClick={()=>setDownloadPaywall(false)}>프로젝트 계속 보기</button>
      </div>
    </div>}

    {premium && !isAdmin && <div className="modal" onMouseDown={e=>{if(e.target===e.currentTarget)setPremium(false)}}>
      <div className="modalCard pricingModal">
        <button className="x" onClick={()=>setPremium(false)}>✕</button>
        <div className="pricingHead"><small>WEARON VIDEO PLANS</small><h2>필요한 만큼 시작하세요.</h2><p>가입비 없는 계좌이체 방식입니다. 입금 확인 후 30일 이용권이 활성화됩니다.</p></div>
        <div className="planGrid">
          {["starter","pro","business"].map(id=>{
            const plan=WEARON_PLANS[id];
            const current=subscription?.plan===id && subscription?.status==="active";
            return <article key={id} className={id==="pro"?"featured":""}>
              {id==="pro" && <span className="recommend">추천</span>}
              <small>{plan.name}</small>
              <strong>₩{plan.price.toLocaleString("ko-KR")}<em>/30일</em></strong>
              <p>{plan.description}</p>
              <ul>
                <li>회원 프로젝트 클라우드 저장</li>
                <li>쇼츠 제작 워크스페이스 이용</li>
                <li>{plan.credits}회 기준 사용량 설계</li>
              </ul>
              <button disabled={current||checkoutBusy} onClick={()=>openCheckout(id)}>{current?"현재 이용 중":checkoutBusy?"준비 중...":"계좌이체로 신청"}</button>
            </article>
          })}
        </div>
        <div className="pricingFoot">현재 플랜: <b>{String(subscription?.plan||"free").toUpperCase()}</b>{subscription?.current_period_end && <> · 이용기간 ~ {new Date(subscription.current_period_end).toLocaleDateString("ko-KR")}</>}</div>
      </div>
    </div>}


    {checkoutPlan && <div className="modal checkoutOverlay" onMouseDown={e=>{if(e.target===e.currentTarget&&!checkoutBusy){setCheckoutPlan(null);setCheckoutOrder(null);}}}>
      <div className="modalCard checkoutModal">
        <button className="x" disabled={checkoutBusy} onClick={()=>{setCheckoutPlan(null);setCheckoutOrder(null);}}>✕</button>
        <div className="checkoutHead">
          <small>BANK TRANSFER · 가입비 0원</small>
          <h2>{checkoutProduct?.name}{checkoutOrder?.productType==="credit_pack"?" 크레딧팩":" 30일 이용권"}</h2>
          <p>입금 금액 <b>₩{checkoutProduct?.price?.toLocaleString("ko-KR")}</b>{checkoutOrder?.productType==="credit_pack" && <> · {checkoutProduct?.credits?.toLocaleString("ko-KR")} 크레딧 / 90일</>}</p>
        </div>

        {checkoutBusy && <div className="paymentLoading">입금 정보를 준비하는 중...</div>}

        {!checkoutBusy && checkoutOrder && <div className="bankTransferBox">
          <div><span>은행</span><b>{checkoutOrder.bank}</b></div>
          <div><span>계좌번호</span><b>{checkoutOrder.account}</b><button type="button" onClick={copyBankAccount}>복사</button></div>
          <div><span>예금주</span><b>{checkoutOrder.holder}</b></div>
          <div><span>입금 금액</span><b>₩{Number(checkoutOrder.amount||0).toLocaleString("ko-KR")}</b></div>
          <div><span>주문번호</span><code>{checkoutOrder.orderId}</code></div>
          <p>입금자명은 회원가입 이름과 동일하게 입력해주세요. 관리자가 실제 입금을 확인한 뒤 {checkoutOrder?.productType==="credit_pack"?"추가 크레딧을 적용":"이용권을 활성화"}합니다.</p>
        </div>}

        {!checkoutBusy && checkoutOrder && <div className="checkoutActivationNotice">
          <b>결제 처리 안내</b>
          <p>입금 확인 후 크레딧 충전 및 회원 이용권 변경이 순차적으로 반영됩니다. 처리 상황에 따라 적용까지 다소 시간이 소요될 수 있으며, 즉시 반영되지 않더라도 중복 결제는 하지 말아주세요.</p>
        </div>}

        <button className="checkoutPay" disabled={checkoutBusy||!checkoutOrder} onClick={refreshBankTransferStatus}>
          {checkoutBusy?"준비 중...":"입금 확인 상태 새로고침"}
        </button>
        <p className="checkoutNotice">카드 PG 가입비 없이 계좌이체로 운영합니다. 입금 전에는 이용권이 활성화되지 않습니다.</p>
      </div>
    </div>}

    {rendering && <div className="rendering"><b>영상 렌더링 중</b><div><span style={{width:`${renderProgress}%`}}/></div><small>{Math.round(renderProgress)}%</small></div>}
    {toast && <div className="toast">{toast}</div>}
  </div>;
}
