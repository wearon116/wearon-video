"use client";

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
import { WEARON_PLANS } from "../lib/plans";

const PENDING_YOUTUBE_JOB_KEY = "wearon_pending_youtube_job_v1";

const nav = [
  ["home","✦","새 프로젝트"],
  ["projects","▦","내 프로젝트"],
  ["templates","▣","템플릿"],
  ["popular","🔥","실시간 인기"],
  ["saved","♡","저장된 영상"],
  ["channels","⌁","채널 연동"],
  ["guide","?","쇼츠 가이드"]
];

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
  const [youtubeAnalysisRange,setYoutubeAnalysisRange] = useState("full");
  const [creditWarning,setCreditWarning] = useState("");
  const [trending,setTrending] = useState([]);
  const [trendStatus,setTrendStatus] = useState("loading");
  const [projects,setProjects] = useState([]);
  const [results,setResults] = useState([]);
  const [analysis,setAnalysis] = useState(0);
  const [analysisMsg,setAnalysisMsg] = useState("");
  const [preview,setPreview] = useState(null);
  const [premium,setPremium] = useState(false);
  const [downloadPaywall,setDownloadPaywall] = useState(false);
  const [subscription,setSubscription] = useState({plan:"free",status:"active",current_period_end:null});
  const [checkoutPlan,setCheckoutPlan] = useState(null);
  const [checkoutOrder,setCheckoutOrder] = useState(null);
  const [checkoutReady,setCheckoutReady] = useState(false);
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
  const tossWidgetsRef = useRef(null);
  const checkoutInitRef = useRef(null);
  const paymentHandledRef = useRef(false);
  const pendingWatcherRef = useRef(false);

  useEffect(()=>{
    let mounted=true;

    (async()=>{
      try{
        await consumeAuthRedirect();
        const current=await getCurrentUser();
        if(!mounted) return;
        setUser(current);
        if(current) {
          await Promise.all([loadCloudProjects(),loadSubscription(),loadAdminStatus()]);
        } else {
          setProjects([]);
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
        await Promise.all([loadCloudProjects(),loadSubscription(),loadAdminStatus()]);
      } else {
        setProjects([]);
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


  useEffect(()=>{
    if(!checkoutPlan || !user) return;
    const t=setTimeout(()=>setupCheckout(checkoutPlan),0);
    return ()=>clearTimeout(t);
  },[checkoutPlan,user]);

  useEffect(()=>{
    if(!authReady || !user || paymentHandledRef.current) return;
    const params=new URLSearchParams(window.location.search);
    const mode=params.get("payment");
    if(!mode) return;

    paymentHandledRef.current=true;

    (async()=>{
      try{
        if(mode==="fail"){
          const message=params.get("message")||"결제가 취소되었거나 실패했습니다.";
          setToast(message);
          return;
        }

        const paymentKey=params.get("paymentKey");
        const orderId=params.get("orderId");
        const amount=Number(params.get("amount"));
        if(!paymentKey || !orderId || !Number.isFinite(amount)) throw new Error("결제 승인 정보가 올바르지 않습니다.");

        const session=await getSession();
        if(!session?.access_token) throw new Error("결제 적용을 위해 다시 로그인해주세요.");

        const res=await fetch("/api/payments/confirm",{
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            Authorization:`Bearer ${session.access_token}`
          },
          body:JSON.stringify({paymentKey,orderId,amount})
        });
        const data=await res.json();
        if(!res.ok) throw new Error(data.message||"결제 승인에 실패했습니다.");

        await loadSubscription();
        setCheckoutPlan(null);
        setPremium(false);
        setToast("결제가 완료되어 요금제가 적용되었습니다.");
      }catch(err){
        setToast(err?.message||"결제 적용 중 오류가 발생했습니다.");
      }finally{
        window.history.replaceState({},document.title,window.location.pathname);
      }
    })();
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

  function loadTossSdk(){
    if(typeof window==="undefined") return Promise.reject(new Error("브라우저에서만 결제할 수 있습니다."));
    if(window.TossPayments) return Promise.resolve(window.TossPayments);

    return new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-wearon-toss="1"]');
      if(existing){
        existing.addEventListener("load",()=>resolve(window.TossPayments),{once:true});
        existing.addEventListener("error",()=>reject(new Error("토스페이먼츠 SDK를 불러오지 못했습니다.")),{once:true});
        return;
      }
      const script=document.createElement("script");
      script.src="https://js.tosspayments.com/v2/standard";
      script.async=true;
      script.dataset.wearonToss="1";
      script.onload=()=>resolve(window.TossPayments);
      script.onerror=()=>reject(new Error("토스페이먼츠 SDK를 불러오지 못했습니다."));
      document.head.appendChild(script);
    });
  }

  function openCheckout(planId){
    if(!user){
      setPremium(false);
      setAuthMode("login");
      setAuthStep("form");
      setAuthModal(true);
      return setToast("결제하려면 먼저 로그인해주세요.");
    }
    if(subscription?.plan===planId && subscription?.status==="active"){
      return setToast("현재 이용 중인 요금제입니다.");
    }
    checkoutInitRef.current=null;
    tossWidgetsRef.current=null;
    setCheckoutOrder(null);
    setCheckoutReady(false);
    setCheckoutPlan(planId);
    setPremium(false);
  }

  async function setupCheckout(planId){
    if(!user || !planId || checkoutInitRef.current===planId) return;
    checkoutInitRef.current=planId;
    setCheckoutBusy(true);
    setCheckoutReady(false);

    try{
      const clientKey=process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
      if(!clientKey) throw new Error("토스페이먼츠 클라이언트 키 연결이 필요합니다.");

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
      if(!orderRes.ok) throw new Error(order.message||"결제 주문 생성에 실패했습니다.");
      setCheckoutOrder(order);

      const TossPayments=await loadTossSdk();
      const tossPayments=TossPayments(clientKey);
      const customerKey=`WV_${user.id}`;
      const widgets=tossPayments.widgets({customerKey});
      tossWidgetsRef.current=widgets;

      await widgets.setAmount({currency:"KRW",value:order.amount});
      await Promise.all([
        widgets.renderPaymentMethods({selector:"#payment-method",variantKey:"DEFAULT"}),
        widgets.renderAgreement({selector:"#agreement",variantKey:"AGREEMENT"})
      ]);
      setCheckoutReady(true);
    }catch(err){
      checkoutInitRef.current=null;
      setToast(err?.message||"결제 화면을 준비하지 못했습니다.");
    }finally{
      setCheckoutBusy(false);
    }
  }

  async function requestPlanPayment(){
    if(!checkoutOrder || !tossWidgetsRef.current) return setToast("결제 화면을 준비 중입니다.");
    try{
      setCheckoutBusy(true);
      const origin=window.location.origin;
      await tossWidgetsRef.current.requestPayment({
        orderId:checkoutOrder.orderId,
        orderName:checkoutOrder.orderName,
        successUrl:`${origin}/?payment=success`,
        failUrl:`${origin}/?payment=fail`,
        customerEmail:user?.email||undefined,
        customerName:user?.user_metadata?.full_name||undefined
      });
    }catch(err){
      setToast(err?.message||"결제 요청이 취소되었거나 실패했습니다.");
      setCheckoutBusy(false);
    }
  }

  async function loadCloudProjects(){
    try{
      const res=await authenticatedFetch("/rest/v1/projects?select=id,title,status,created_at,clips(count)&order=created_at.desc");
      if(!res.ok) throw new Error();
      const rows=await res.json();
      setProjects((rows||[]).map(p=>({
        id:p.id,
        title:p.title,
        clips:p.clips?.[0]?.count || 0,
        createdAt:new Date(p.created_at).toLocaleString("ko-KR"),
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
          status:"ready"
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
          thumbnailSubtitle:c.thumbnailSubtitle||""
        },
        status:"candidate"
      }));

      const clipRes=await authenticatedFetch("/rest/v1/clips",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(clipRows)
      });
      if(!clipRes.ok) throw new Error(await clipRes.text());

      await loadCloudProjects();
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
          await Promise.all([loadCloudProjects(),loadSubscription(),loadAdminStatus()]);
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
        await Promise.all([loadCloudProjects(),loadSubscription(),loadAdminStatus()]);
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
      await Promise.all([loadCloudProjects(),loadSubscription(),loadAdminStatus()]);
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
      setProjects([]);
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

      let completed=null;

      for(let attempt=0;attempt<600;attempt++){
        // 첫 상태 확인은 즉시 실행하고, 초반에는 더 촘촘하게 확인합니다.
        // 영상 분석/렌더링 옵션은 건드리지 않아 결과 퀄리티는 그대로 유지됩니다.
        if(attempt>0){
          const waitMs=attempt<20?1800:attempt<60?3500:6500;
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
            const next={...job,progress:job.progress||18,message:"OpusClip 처리 중 · 잠시 후 자동으로 다시 확인합니다."};
            job=next;
            storePendingYoutubeJob(next);
            continue;
          }
          throw new Error(status?.message||"자동 컷 상태를 확인하지 못했습니다.");
        }

        if(status?.status==="failed"){
          throw new Error(status?.error?.message||"YouTube 자동 컷 생성에 실패했습니다.");
        }

        const providerProgress=Math.max(0,Math.min(100,Number(status?.progress||0)));
        const visualProgress=status?.status==="completed"
          ? 100
          : Math.min(94,Math.max(providerProgress,18+Math.min(72,attempt*1.25)));

        const fallbackMessage=visualProgress<30
          ? "YouTube 원본 영상을 불러오는 중..."
          : visualProgress<65
            ? "AI가 전체 영상에서 핵심 장면을 분석하는 중..."
            : visualProgress<90
              ? "선택한 장면을 쇼츠 영상으로 렌더링하는 중..."
              : "완성된 쇼츠 파일을 정리하는 중...";

        const message=String(status?.message||fallbackMessage);
        const firstReady=Array.isArray(status?.clips)&&status.clips.length?status.clips[0]:null;
        const next={
          ...job,
          progress:Math.round(visualProgress),
          message,
          phase:status?.phase||job?.phase||"analyze",
          readyClipCount:Number(status?.readyClipCount||status?.clipCount||0),
          previewUrl:String(firstReady?.previewUrl||job?.previewUrl||""),
          previewTitle:String(firstReady?.title||job?.previewTitle||"")
        };
        job=next;
        storePendingYoutubeJob(next);
        setAnalysis(Math.round(visualProgress));
        setAnalysisMsg(message);

        if(status?.status==="completed"){
          completed=status;
          break;
        }
      }

      if(!completed){
        const next={...job,progress:Math.max(85,job.progress||0),message:"작업이 계속 진행 중입니다. 잠시 후 다시 확인해주세요."};
        storePendingYoutubeJob(next);
        setToast("작업이 길어지고 있지만 중단된 것은 아닙니다. 내 프로젝트에서 다시 확인할 수 있습니다.");
        return;
      }

      const clipCount=Math.min(6,Math.max(0,Number(completed?.clipCount||0)));
      if(!clipCount) throw new Error("AI 분석은 완료됐지만 완성된 쇼츠 파일을 찾지 못했습니다.");

      const meta=job?.meta||{};
      if(meta?.title || meta?.thumbnail || Array.isArray(meta?.comments)) setYtMeta(meta);

      const realComments=Array.isArray(meta?.comments)?meta.comments:[];
      const pickComments=(index)=>{
        if(!realComments.length) return [];
        const count=Math.min(3,realComments.length);
        return Array.from({length:count},(_,offset)=>realComments[(index+offset)%realComments.length]);
      };

      const baseResults=Array.from({length:clipCount},(_,index)=>{
        const clipMeta=completed?.clips?.[index]||{};
        const duration=Number(clipMeta?.duration||0)||35;
        const fallbackTitle=String(meta?.title||"YouTube 영상").replace(/\s+/g," ").trim();
        const hook=String(clipMeta?.title||`${fallbackTitle} · 핵심 장면 ${index+1}`).slice(0,100);
        const videoUrl=String(clipMeta?.previewUrl||clipMeta?.exportUrl||"");

        return {
          id:index+1,
          score:Number(clipMeta?.score||0)||Math.max(80,95-index*3),
          start:Number(clipMeta?.start||0),
          duration,
          hook,
          reason:"AI가 원본 전체 영상에서 쇼츠로 보기 좋은 핵심 장면을 골라낸 결과입니다.",
          transcript:String(clipMeta?.transcript||""),
          comments:pickComments(index),
          thumbnailTitle:hook,
          thumbnailSubtitle:"핵심 장면",
          aiGenerated:true,
          sourceClip:true,
          videoUrl,
          mediaLoading:!videoUrl,
          mediaError:false,
          remoteJobId:job.jobId,
          remoteAccessToken:job.accessToken,
          remoteIndex:index
        };
      });

      // OpusClip CDN 미리보기 주소를 바로 사용해, MP4 전체를 Vercel→브라우저로
      // 다시 다운로드하던 대기 시간을 없앴습니다. 고화질 원본은 다운로드 버튼을
      // 누를 때만 서버를 통해 가져옵니다.
      clearPendingYoutubeJob();
      setResults(baseResults);
      setPreview(null);
      setAnalysis(100);
      setAnalysisMsg("YouTube 원본 영상에서 쇼츠 후보 생성이 완료됐습니다.");
      setPage("results");
      setToast("쇼츠 생성이 완료됐습니다.");

      void saveCloudProject(
        meta?.title||"YouTube 자동 쇼츠",
        baseResults,
        "",
        "youtube",
        job.youtubeUrl
      );
    }catch(err){
      const next={...job,error:err?.message||"자동 쇼츠 처리 중 오류가 발생했습니다.",message:"오류가 발생했습니다. 다시 확인을 누르면 이어서 확인합니다."};
      storePendingYoutubeJob(next);
      if(!resume) setPage("projects");
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
          maxAnalysisSeconds:youtubeAnalysisRange==="full" ? 0 : Number(youtubeAnalysisRange||0)*60
        })
      });

      const created=await createRes.json();
      if(!createRes.ok){
        if(created?.code==="INSUFFICIENT_OPUS_CREDITS"){
          setCreditWarning(created?.message||"OpusClip 크레딧이 부족합니다.");
        }
        throw new Error(created?.message||"YouTube 자동 컷 작업을 시작하지 못했습니다.");
      }

      const job={
        jobId:created.jobId,
        accessToken:created.accessToken,
        youtubeUrl:url.trim(),
        progress:12,
        message:youtubeAnalysisRange==="full"
          ? "OpusClip이 YouTube 전체 영상을 분석하고 있습니다."
          : `OpusClip이 영상의 처음 ${youtubeAnalysisRange}분을 분석하고 있습니다.`,
        createdAt:Date.now(),
        meta:{
          title:ytMeta?.title||"YouTube 자동 쇼츠",
          channelTitle:ytMeta?.channelTitle||"",
          thumbnail:ytMeta?.thumbnail||"",
          comments:Array.isArray(ytMeta?.comments)?ytMeta.comments.slice(0,12):[],
          analysisRange:youtubeAnalysisRange
        }
      };

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
      setPremium(true);
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
          sourcePath:storagePath,
          filename:file.name,
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
        id:index+1
      }));
      if(newResults.length!==3) throw new Error("AI가 쇼츠 후보 3개를 만들지 못했습니다.");

      setAnalysis(92);
      setAnalysisMsg("선택한 쇼츠 후보를 저장하는 중...");

      await saveCloudProject(ytMeta?.title || file.name,newResults,storagePath);
      setResults(newResults);
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
    setPremium(true);
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
    const width=canvas.width;
    const height=Math.round(width*9/16);
    const y=Math.round(canvas.height*.13);
    return {x:0,y,width,height};
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
        const res=await fetch(`/api/youtube/avatar?url=${encodeURIComponent(avatar)}`,{cache:"force-cache"});
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

  function drawShortSocialOverlay(ctx,clip,canvas,progress=0){
    const comments=Array.isArray(clip?.comments)?clip.comments.filter(x=>commentText(x)):[];
    const avatars=Array.isArray(clip?.commentAvatarImages)?clip.commentAvatarImages:[];
    const title=String(clip?.thumbnailTitle||clip?.hook||"오늘의 핵심").slice(0,64);
    const subtitle=String(clip?.thumbnailSubtitle||"핵심 장면").slice(0,42);

    const topH=Math.round(canvas.height*.115);
    ctx.fillStyle="#050506";
    ctx.fillRect(0,0,canvas.width,topH);

    ctx.textAlign="center";
    ctx.textBaseline="alphabetic";
    ctx.fillStyle="#fff";
    ctx.font=`900 ${Math.max(34,Math.round(canvas.width*.047))}px "Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif`;
    const titleLines=wrapCanvasText(ctx,title,canvas.width-Math.round(canvas.width*.10),2);
    const titleLineH=Math.max(50,Math.round(canvas.width*.057));
    const firstY=Math.round(topH*.38);
    titleLines.forEach((line,i)=>ctx.fillText(line,canvas.width/2,firstY+i*titleLineH));

    ctx.fillStyle="#55d9e6";
    ctx.font=`800 ${Math.max(24,Math.round(canvas.width*.03))}px "Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif`;
    ctx.fillText(subtitle,canvas.width/2,topH-Math.round(canvas.height*.018));

    // 댓글은 영상 첫 프레임부터 보이게 하고, 실제 YouTube 댓글을 캡처 카드처럼 배치합니다.
    if(comments.length){
      const videoRect=sourceVideoRect(canvas);
      const startY=videoRect.y+videoRect.height+Math.round(canvas.height*.035);
      const visibleCount=Math.min(3,comments.length);
      const gap=Math.round(canvas.height*.014);
      const bottomReserve=Math.round(canvas.height*.08);
      const available=canvas.height-startY-bottomReserve-gap*(visibleCount-1);
      const cardH=Math.min(Math.round(canvas.height*.135),Math.floor(available/visibleCount));
      const side=Math.round(canvas.width*.035);
      const cardW=canvas.width-side*2;
      const base=comments.length<=visibleCount
        ? 0
        : Math.floor(progress*comments.length*1.35)%comments.length;

      for(let slot=0;slot<visibleCount;slot++){
        const index=(base+slot)%comments.length;
        const item=comments[index];
        const y=startY+slot*(cardH+gap);
        drawYoutubeCommentCard(ctx,item,avatars[index]||null,side,y,cardW,cardH);
      }
    }

    const wmY=canvas.height-Math.round(canvas.height*.022);
    ctx.textAlign="center";
    ctx.fillStyle="rgba(255,255,255,.86)";
    ctx.font=`800 ${Math.max(16,Math.round(canvas.width*.019))}px system-ui,sans-serif`;
    ctx.fillText("WEARON VIDEO",canvas.width/2,wmY);
  }

  async function getVideoFrameSource(src,seekSeconds=1){
    const video=document.createElement("video");
    video.src=src;
    video.muted=true;
    video.playsInline=true;
    video.preload="auto";
    await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});
    const target=Math.min(Math.max(0,seekSeconds),Math.max(0,(video.duration||seekSeconds)-.1));
    if(target>0){
      video.currentTime=target;
      await new Promise(resolve=>{video.onseeked=resolve;});
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
          `/api/ai/recreate?action=content&index=${Number(clip.remoteIndex||0)}&jobId=${encodeURIComponent(clip.remoteJobId)}&token=${encodeURIComponent(clip.remoteAccessToken)}`,
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
      canvas.width=1080;
      canvas.height=1920;
      const ctx=canvas.getContext("2d");
      ctx.fillStyle="#050506";
      ctx.fillRect(0,0,canvas.width,canvas.height);

      const src=thumbClip?.aiGenerated ? thumbClip?.videoUrl : fileUrl;
      if(src){
        const frame=await getVideoFrameSource(src,thumbClip?.aiGenerated?1:(thumbClip?.start||0)+1);
        const rect=sourceVideoRect(canvas);
        const vw=frame.videoWidth||1920, vh=frame.videoHeight||1080;
        const sourceRatio=vw/vh;
        const boxRatio=rect.width/rect.height;
        let dx=rect.x,dy=rect.y,dw=rect.width,dh=rect.height;
        if(sourceRatio>boxRatio){
          dh=rect.width/sourceRatio;
          dy=rect.y+(rect.height-dh)/2;
        }else{
          dw=rect.height*sourceRatio;
          dx=rect.x+(rect.width-dw)/2;
        }
        ctx.fillStyle="#000";
        ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
        ctx.drawImage(frame,0,0,vw,vh,dx,dy,dw,dh);
      }

      drawShortSocialOverlay(ctx,thumbClip,canvas,0);
      const href=canvas.toDataURL("image/png",1);
      const a=document.createElement("a");
      a.href=href;
      a.download=`WEARON_THUMBNAIL_${clip?.id||1}.png`;
      a.click();
      setToast("9:16 썸네일 PNG 다운로드를 시작했습니다.");
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
      setToast("9:16 완성본을 렌더링하고 있습니다...");

      let renderUrl=clip.videoUrl;
      if(clip?.sourceClip && clip?.remoteJobId && clip?.remoteAccessToken){
        const session=await getSession();
        if(!session?.access_token) throw new Error("로그인이 만료되었습니다.");
        const res=await fetch(
          `/api/ai/recreate?action=content&index=${Number(clip.remoteIndex||0)}&jobId=${encodeURIComponent(clip.remoteJobId)}&token=${encodeURIComponent(clip.remoteAccessToken)}`,
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
      canvas.width=1080;
      canvas.height=1920;
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
      const draw=()=>{
        ctx.fillStyle="#050506";
        ctx.fillRect(0,0,canvas.width,canvas.height);

        const rect=sourceVideoRect(canvas);
        const vw=video.videoWidth||1920;
        const vh=video.videoHeight||1080;
        const sourceRatio=vw/vh;
        const boxRatio=rect.width/rect.height;
        let dx=rect.x,dy=rect.y,dw=rect.width,dh=rect.height;

        if(sourceRatio>boxRatio){
          dh=rect.width/sourceRatio;
          dy=rect.y+(rect.height-dh)/2;
        }else{
          dw=rect.height*sourceRatio;
          dx=rect.x+(rect.width-dw)/2;
        }

        ctx.fillStyle="#000";
        ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
        ctx.drawImage(video,0,0,vw,vh,dx,dy,dw,dh);

        // 실제 댓글은 첫 프레임부터 표시하고, 작성자 이름만 모자이크합니다.
        drawShortSocialOverlay(ctx,renderClip,canvas,Math.min(1,video.currentTime/duration));
      };

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
      setToast("9:16 완성본 다운로드를 시작했습니다.");
    }catch{
      setToast("9:16 완성본 렌더링에 실패했습니다. Chrome/Edge에서 다시 시도해주세요.");
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
      const video=document.createElement("video");
      video.src=fileUrl; video.muted=false; video.playsInline=true;
      await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});

      const start=Math.min(clip.start,Math.max(0,video.duration-0.5));
      const dur=Math.min(clip.duration,Math.max(0.5,video.duration-start));
      video.currentTime=start;
      await new Promise(resolve=>{video.onseeked=resolve;});

      const canvas=document.createElement("canvas");
      const canvasSize={
        "9:16":[540,960],
        "4:5":[640,800],
        "1:1":[720,720],
        "16:9":[960,540]
      }[aspectRatio]||[540,960];
      canvas.width=canvasSize[0]; canvas.height=canvasSize[1];
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
        const vw=video.videoWidth, vh=video.videoHeight;
        const targetRatio=canvas.width/canvas.height, sourceRatio=vw/vh;
        let sx=0,sy=0,sw=vw,sh=vh;
        if(sourceRatio>targetRatio){ sw=vh*targetRatio; sx=(vw-sw)/2; }
        else { sh=vw/targetRatio; sy=(vh-sh)/2; }

        ctx.fillStyle="#070a11";
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);

        drawShortSocialOverlay(
          ctx,
          clip,
          canvas,
          Math.min(1,Math.max(0,(video.currentTime-start)/Math.max(.5,dur)))
        );

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
      <button className="plan" onClick={()=>isAdmin?setToast("관리자 계정은 WEARON 크레딧 제한 없이 이용됩니다."):setPremium(true)}>◆ {isAdmin ? "관리자 · 무제한" : `요금제 ${String(subscription?.plan||"free").toUpperCase()}`}</button>
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
            <small>YouTube 링크만 넣으면 OpusClip이 원본 전체 영상에서 반응이 좋은 장면을 골라 9:16 쇼츠로 자동 편집합니다. 별도 원본 파일은 필요하지 않습니다.</small>
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

          {file ? <div className="builderBlock">
            <div className="builderTitle"><div><b>사용할 영상 구간</b><span>AI가 이 범위 안에서 가장 강한 장면을 찾습니다.</span></div><strong>{clock(rangeStart)} → {clock(rangeEnd)}</strong></div>
            <div className="rangePair">
              <input type="range" min="0" max={Math.max(8,fileDuration||60)} step="1" value={Math.min(rangeStart,Math.max(0,rangeEnd-8))} onChange={e=>setRangeStart(Math.min(Number(e.target.value),rangeEnd-8))}/>
              <input type="range" min="8" max={Math.max(8,fileDuration||60)} step="1" value={rangeEnd} onChange={e=>setRangeEnd(Math.max(Number(e.target.value),rangeStart+8))}/>
            </div>
            <div className="rangeInputs"><label>시작<input type="number" min="0" value={Math.round(rangeStart)} onChange={e=>setRangeStart(Math.max(0,Math.min(Number(e.target.value)||0,rangeEnd-8)))}/></label><label>종료<input type="number" min={rangeStart+8} value={Math.round(rangeEnd)} onChange={e=>setRangeEnd(Math.max(rangeStart+8,Number(e.target.value)||rangeStart+8))}/></label></div>
          </div> : <div className="builderBlock linkOnlyNotice">
            <div className="builderTitle"><div><b>YouTube 원본 자동 컷</b><span>새 영상을 생성하는 방식이 아니라 원본 전체에서 재미·반응·후킹이 강한 장면을 찾아 쇼츠로 자릅니다.</span></div><strong>최대 6개 쇼츠</strong></div>
            <div className="opusRangeBox">
              <div className="opusRangeHead">
                <div><b>분석 범위</b><span>OpusClip은 일반적으로 원본 영상 1분 분석에 약 1크레딧을 사용합니다.</span></div>
                <strong>{ytMeta?.duration ? `예상 약 ${Math.max(1,Math.ceil(Math.min(durationToSeconds(ytMeta.duration),youtubeAnalysisRange==="full"?durationToSeconds(ytMeta.duration):Number(youtubeAnalysisRange)*60)/60))} 크레딧` : "영상 길이 확인 중"}</strong>
              </div>
              <div className="opusRangeBtns">
                <button type="button" className={youtubeAnalysisRange==="full"?"selected":""} onClick={()=>setYoutubeAnalysisRange("full")}>전체 영상</button>
                <button type="button" className={youtubeAnalysisRange==="30"?"selected":""} onClick={()=>setYoutubeAnalysisRange("30")}>처음 30분</button>
                <button type="button" className={youtubeAnalysisRange==="60"?"selected":""} onClick={()=>setYoutubeAnalysisRange("60")}>처음 60분</button>
              </div>
              <small>크레딧이 부족하면 30분 또는 60분으로 먼저 테스트할 수 있습니다. 전체 영상 분석이 필요하면 전체 영상을 선택하세요.</small>
            </div>
            {creditWarning&&<div className="opusCreditWarning"><b>⚠ OpusClip 크레딧 부족</b><span>{creditWarning}</span><a href="https://clip.opus.pro" target="_blank" rel="noreferrer">OpusClip에서 크레딧 확인 ↗</a></div>}
          </div>}

          <div className="builderBlock twoCols">
            <label>원본 언어<select disabled><option>자동 감지</option></select></label>
            <label>AI 제목 언어<select value={hookLanguage} onChange={e=>setHookLanguage(e.target.value)}><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option></select></label>
          </div>

          <div className="builderBlock">
            <div className="builderTitle"><div><b>템플릿</b><span>자동자막 없이 후킹 제목·원본 영상·댓글 오버레이 구성을 선택합니다.</span></div></div>
            <div className="templateStrip">
              {[
                ["후킹 제목","상단 후킹 제목"],
                ["댓글형","원본 + 실제 댓글"],
                ["미니멀","영상 중심"],
                ["인터뷰형","대화 구도형"],
                ["리뷰형","정보 요약형"]
              ].map(([name,desc])=><button key={name} className={selectedTemplate===name?"selected":""} onClick={()=>setSelectedTemplate(name)}><div className="miniTemplate"><strong>{name}</strong><span>{desc}</span></div><b>{name}</b></button>)}
            </div>
          </div>

          <div className="builderBlock builderOptions">
            <div><b>영상 비율</b><div className="ratioBtns">{(file?["9:16","4:5","1:1","16:9"]:["9:16","16:9"]).map(r=><button key={r} className={aspectRatio===r?"selected":""} onClick={()=>setAspectRatio(r)}>{r}</button>)}</div></div>
            <div><b>브랜드 컬러</b><div className="colorRow">{["#ff6559","#ff8a65","#ffd05a","#54d8cf","#7c5cff","#4c84ff"].map(color=><button key={color} className={brandColor===color?"selected":""} style={{background:color}} onClick={()=>setBrandColor(color)} aria-label={color}/>)}</div></div>
          </div>

          <label className="rightsCheck"><input type="checkbox" checked={rightsConfirmed} onChange={e=>setRightsConfirmed(e.target.checked)}/><div><b>원본 영상 권리 확인</b><span>이 영상을 내가 소유하고 있거나 쇼츠 제작·편집 및 이용에 필요한 허가를 받았습니다.</span></div></label>

          {!file && sourceMode!=="youtube" && <button className="connectOriginal" onClick={()=>fileInput.current?.click()}>원본 파일 연결</button>}
          <button className="generateShorts" onClick={startProject}>{sourceMode==="youtube"&&!file ? (youtubeAnalysisRange==="full"?"전체 영상에서 쇼츠 자동 생성하기":`처음 ${youtubeAnalysisRange}분에서 쇼츠 생성하기`) : "쇼츠 생성하기"} <span>→</span></button>
        </section>}

        <section className="section">
          <div className="sectionHead"><div><small>RECENT WORK</small><h2>내 프로젝트</h2></div><button onClick={()=>setPage("projects")}>전체보기 →</button></div>
          <div className="projectGrid">
            {(projects.length?projects.slice(0,3):[
              {id:1,title:"WEARON VIDEO 시작하기",clips:3,createdAt:"새 프로젝트를 만들어보세요"},
              {id:2,title:"실시간 인기에서 아이디어 찾기",clips:0,createdAt:"YouTube API 연동 후 자동 갱신"},
              {id:3,title:"9:16 브라우저 렌더링",clips:3,createdAt:"Chrome/Edge 권장"}
            ]).map(p=><article key={p.id}><div className="cover"><span>WEARON VIDEO</span></div><h3>{p.title}</h3><p>쇼츠 {p.clips}개 · {p.createdAt}</p></article>)}
          </div>
        </section>
      </section>}

      {page==="popular" && <section className="page">
        <div className="pageHead"><div><small>TREND DISCOVERY</small><h1>🔥 실시간 인기</h1><p>대한민국 YouTube 인기 영상 데이터를 5분마다 갱신합니다.</p></div><button onClick={loadTrending}>↻ 새로고침</button></div>
        {trendStatus==="key" && <div className="notice"><b>YouTube API 키만 연결하면 실시간 데이터가 시작됩니다.</b><span>Vercel 환경 변수에 <code>YOUTUBE_API_KEY</code>를 추가하면 이 화면이 자동으로 실제 인기 영상으로 바뀝니다.</span></div>}
        {trendStatus==="loading" && <div className="loading">YouTube 인기 영상 불러오는 중…</div>}
        <div className="trendGrid">
          {trending.map(v=><article key={v.id}>
            <div className="trendThumb"><img src={v.thumbnail} alt=""/><b>{v.rank}</b><span>{durationToText(v.duration)}</span></div>
            <h3>{v.title}</h3><p>{v.channelTitle}</p><div className="meta"><span>조회수 {fmt(v.viewCount)}</span><a href={v.url} target="_blank" rel="noreferrer">YouTube ↗</a></div>
          </article>)}
        </div>
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
          {projects.length ? projects.map(p=><article key={p.id}><div className="miniCover">W</div><div><h3>{p.title}</h3><p>쇼츠 {p.clips}개 · {p.createdAt}</p></div><button onClick={()=>setPage("results")}>열기</button></article>) : !pendingYoutubeJob&&<div className="empty">아직 프로젝트가 없습니다.</div>}
        </div>
      </section>}

      {page==="templates" && <section className="page">
        <div className="pageHead"><div><small>SHORTS STYLES</small><h1>템플릿</h1><p>WEARON VIDEO 전용 숏폼 스타일입니다.</p></div></div>
        <div className="templates">{templateData.map(([n,d])=><article key={n}><div className="templatePreview"><b>{n}</b><span>WEARON</span></div><h3>{n}</h3><p>{d}</p></article>)}</div>
      </section>}

      {page==="saved" && <section className="page center"><div className="emptyCard"><b>♡</b><h2>저장된 영상</h2><p>실시간 인기에서 저장한 영상이 표시될 영역입니다.</p><button onClick={()=>setPage("popular")}>실시간 인기 보기</button></div></section>}

      {page==="channels" && <section className="page">
        <div className="pageHead"><div><small>CONNECTIONS</small><h1>채널 연동</h1><p>배포 후 OAuth 연동을 붙일 수 있도록 UI를 준비했습니다.</p></div></div>
        <div className="channels">{[["▶","YouTube","쇼츠 업로드/채널 분석"],["◎","Instagram","릴스 게시"],["♪","TikTok","숏폼 게시"]].map(x=><article key={x[1]}><div>{x[0]}</div><section><b>{x[1]}</b><span>{x[2]}</span></section><button onClick={()=>setToast("OAuth 앱 설정 후 활성화됩니다.")}>연동하기</button></article>)}</div>
      </section>}

      {page==="guide" && <section className="page">
        <div className="pageHead"><div><small>GUIDE</small><h1>쇼츠 가이드</h1></div></div>
        <div className="guide">{[
          ["01","YouTube 링크 입력","긴 YouTube 원본 링크를 넣고 영상 정보를 불러옵니다."],
          ["02","원본 전체 분석","새 AI 영상을 만드는 것이 아니라 원본에서 재미·후킹·반응이 강한 구간을 찾습니다."],
          ["03","쇼츠 6개 자동 컷","상위 장면을 최대 6개로 선별하고 자동자막 없이 쇼츠 프레임과 후킹 제목을 구성합니다."],
          ["04","미리보기와 다운로드","결과는 OpusClip CDN에서 바로 미리보고, 고화질 MP4는 다운로드할 때만 불러옵니다."]
        ].map(x=><article key={x[0]}><em>{x[0]}</em><h3>{x[1]}</h3><p>{x[2]}</p></article>)}</div>
      </section>}

      {page==="analysis" && <section className="page analysis easyProcessingPage">
        <div className="easyProcessingTop">
          <b>WEARON VIDEO</b>
          <button disabled={!pendingYoutubeJob?.readyClipCount} onClick={()=>pendingYoutubeJob?.readyClipCount&&setPage("projects")}>바로 결과 보기</button>
        </div>
        <div className="bar easyProcessingBar"><span style={{width:`${analysis}%`}}/></div>
        <div className="easyProcessingBody">
          <div className="easyProcessingPhone">
            {pendingYoutubeJob?.previewUrl
              ? <video src={pendingYoutubeJob.previewUrl} muted autoPlay loop playsInline/>
              : ytMeta?.thumbnail
                ? <img src={ytMeta.thumbnail} alt="원본 영상"/>
                : <div className="easyProcessingPlaceholder">W</div>}
          </div>
          <div className="easyProcessingInfo">
            <div className="easyProcessingCount"><span>SHORT {String(Math.max(1,Number(pendingYoutubeJob?.readyClipCount||1))).padStart(2,"0")}</span><b>{Math.min(6,Number(pendingYoutubeJob?.readyClipCount||0))}/6</b></div>
            <h1>{pendingYoutubeJob?.previewTitle||ytMeta?.title||"원본 영상에서 핵심 장면을 찾는 중"}</h1>
            <p>{analysisMsg}</p>
            <div className="easyProcessingSteps">
              {[
                ["후킹 제목",32],
                ["AI 장면 선정",50],
                ["세로 프레임",68],
                ["댓글 오버레이",82],
                ["결과 준비",96]
              ].map(([label,point])=><div key={label} className={analysis>=point?"done":""}><i>{analysis>=point?"✓":""}</i><span>{label}</span></div>)}
            </div>
            <div className="easyProcessingHighlight"><b>✦ AI 하이라이트</b><span>자동자막은 사용하지 않고 원본 영상의 강한 구간, 후킹 제목, 실제 댓글 오버레이만 구성합니다.</span></div>
            <strong className="easyProcessingPercent">{Math.round(analysis)}%</strong>
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
          <button className="easyAllDownload" onClick={()=>setToast("각 쇼츠에서 ⚡ 빠른 MP4 또는 💬 댓글 포함 완성본을 선택해 다운로드할 수 있습니다.")}>↓ 쇼츠 다운로드</button>
        </div>

        <div className="easyResultList">
          {results.length ? results.map(c=>{
            const comments=Array.isArray(c.comments)?c.comments.filter(x=>commentText(x)):[];
            const firstComment=comments[0]||null;
            const mediaSrc=c.aiGenerated?c.videoUrl:fileUrl;
            return <article className="easyResultItem" key={c.id}>
              <h2><em>#{c.id}</em> {c.hook}</h2>
              <div className="easyResultBody">
                <div className="easyPreviewCol">
                  <div className={`easyPortrait socialPortrait ${c.sourceClip?"sourceClipPortrait":""}`}>
                    {c.previewImage?<img src={c.previewImage} alt="쇼츠 미리보기"/>:c.mediaLoading?<div className="clipMediaLoading"><b>영상 불러오는 중...</b><span>AI 분석은 완료됐습니다</span></div>:c.mediaError?<div className="clipMediaLoading"><b>영상 로드 실패</b><span>페이지를 새로고침하지 말고 다시 시도해주세요</span></div>:<video src={mediaSrc} muted preload="metadata" loop playsInline/>}
                    <div className="socialTitleCard">
                      <b>{c.thumbnailTitle||c.hook}</b>
                      <strong>{c.thumbnailSubtitle||"핵심 장면"}</strong>
                    </div>
                    {comments.length>0&&<div className="sourceCommentsStack">
                      {comments.slice(0,2).map((comment,index)=><div className="socialCommentCard" key={index}>
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
                    <span className="easyDuration">{Math.round(c.duration||12)}초</span>
                    <span className="easyBrand">WEARON VIDEO</span>
                  </div>
                  <div className="easyPreviewActions downloadChoices">
                    <button disabled={c.mediaLoading||c.mediaError||!c.videoUrl} onClick={()=>setPreview(c)}>{c.mediaLoading?"⏳ 준비 중":"▶ 미리보기"}</button>
                    <button disabled={c.mediaLoading||c.mediaError||!c.videoUrl} className="fastDownloadBtn" onClick={()=>requestFastDownload(c)}>↓ 9:16 완성본</button>
                    <button disabled={c.mediaLoading||c.mediaError||!c.videoUrl} className="commentDownloadBtn" onClick={()=>requestDownload(c)}>💬 댓글 포함 저장</button>
                    <button disabled={c.mediaLoading||c.mediaError||!c.videoUrl} onClick={()=>downloadThumbnail(c)}>▣ 썸네일</button>
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
            : <video src={preview.aiGenerated?preview.videoUrl:fileUrl} controls autoPlay playsInline onLoadedMetadata={e=>{if(!preview.aiGenerated)e.currentTarget.currentTime=Math.min(preview.start,e.currentTarget.duration||preview.start)}}/>}
          <div className="hook">{preview.hook}</div>
          {preview.sourceClip&&Array.isArray(preview.comments)&&preview.comments.length>0&&<div className="modalCommentsStack">
            {preview.comments.slice(0,2).map((comment,index)=><div className="modalCommentCard" key={index}>
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
        <div className="previewCopy"><small>{preview.testMode?"ADMIN FREE TEST":preview.sourceClip?"YOUTUBE AUTO CLIP":preview.aiGenerated?"AI SHORT":"SHORT PREVIEW"}</small><h2>#{preview.id} {preview.hook}</h2><p>{preview.testMode?"API를 호출하지 않는 관리자 무료 테스트 결과입니다. 실제 자동 컷은 테스트 모드를 끄고 실행하세요.":preview.sourceClip?"최종 저장본은 9:16, 원본 영상은 16:9로 유지하고 실제 YouTube 댓글은 작성자 이름만 모자이크해 처음부터 표시합니다.":preview.aiGenerated?"AI 처리 영상입니다.":"AI가 실제 음성을 전사하고 선택한 구간입니다."}</p><button className="primary fastPreviewDownload" onClick={()=>requestFastDownload(preview)}>↓ {preview.testMode?"테스트 영상 다운로드":"9:16 완성본 저장"}</button><button className="commentPreviewDownload" onClick={()=>requestDownload(preview)}>💬 댓글 포함 저장</button><button onClick={()=>isAdmin?setToast("관리자 계정은 WEARON 크레딧 제한 없이 이용됩니다."):setPremium(true)}>✎ PRO 편집기 보기</button></div>
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
        <div className="pricingHead"><small>WEARON VIDEO PLANS</small><h2>필요한 만큼 시작하세요.</h2><p>현재 결제는 30일 이용권 방식입니다. 자동 갱신 구독은 빌링 계약 연결 후 추가할 수 있습니다.</p></div>
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
              <button disabled={current} onClick={()=>openCheckout(id)}>{current?"현재 이용 중":"이 요금제 선택"}</button>
            </article>
          })}
        </div>
        <div className="pricingFoot">현재 플랜: <b>{String(subscription?.plan||"free").toUpperCase()}</b>{subscription?.current_period_end && <> · 이용기간 ~ {new Date(subscription.current_period_end).toLocaleDateString("ko-KR")}</>}</div>
      </div>
    </div>}

    {checkoutPlan && <div className="modal checkoutOverlay" onMouseDown={e=>{if(e.target===e.currentTarget&&!checkoutBusy){setCheckoutPlan(null);checkoutInitRef.current=null;}}}>
      <div className="modalCard checkoutModal">
        <button className="x" disabled={checkoutBusy} onClick={()=>{setCheckoutPlan(null);checkoutInitRef.current=null;}}>✕</button>
        <div className="checkoutHead">
          <small>TOSS PAYMENTS · TEST/READY</small>
          <h2>{WEARON_PLANS[checkoutPlan]?.name} 30일 이용권</h2>
          <p>결제 금액 <b>₩{WEARON_PLANS[checkoutPlan]?.price.toLocaleString("ko-KR")}</b></p>
        </div>
        <div id="payment-method" className="tossArea">{checkoutBusy&&!checkoutReady && <div className="paymentLoading">결제수단 불러오는 중...</div>}</div>
        <div id="agreement" className="tossArea agreementArea"></div>
        <button className="checkoutPay" disabled={!checkoutReady||checkoutBusy} onClick={requestPlanPayment}>{checkoutBusy?"처리 중...":checkoutReady?"결제하기":"결제 준비 중"}</button>
        <p className="checkoutNotice">실제 결제는 Vercel에 토스페이먼츠 테스트/라이브 키를 연결한 뒤 작동합니다. 시크릿 키는 브라우저에 노출되지 않습니다.</p>
      </div>
    </div>}

    {rendering && <div className="rendering"><b>9:16 영상 렌더링 중</b><div><span style={{width:`${renderProgress}%`}}/></div><small>{Math.round(renderProgress)}%</small></div>}
    {toast && <div className="toast">{toast}</div>}
  </div>;
}
