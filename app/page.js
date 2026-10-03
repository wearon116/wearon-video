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
  ["자막 강조","핵심 단어를 크게 강조하는 기본형"],
  ["댓글형","AI 댓글 문구를 카드처럼 보여주는 형식"],
  ["미니멀","원본 영상에 집중하는 깔끔한 레이아웃"],
  ["게임형","게임/스트리밍용 상단 후킹형"],
  ["인터뷰형","대화 흐름과 화자 자막을 살린 형식"],
  ["리뷰형","제품/서비스 포인트를 빠르게 요약"],
  ["브이로그형","감성 컷 + 짧은 자막 중심"],
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

export default function Home(){
  const [page,setPage] = useState("home");
  const [sourceMode,setSourceMode] = useState("youtube");
  const [url,setUrl] = useState("");
  const [ytMeta,setYtMeta] = useState(null);
  const [file,setFile] = useState(null);
  const [fileUrl,setFileUrl] = useState("");
  const [trending,setTrending] = useState([]);
  const [trendStatus,setTrendStatus] = useState("loading");
  const [projects,setProjects] = useState([]);
  const [results,setResults] = useState([]);
  const [analysis,setAnalysis] = useState(0);
  const [analysisMsg,setAnalysisMsg] = useState("");
  const [preview,setPreview] = useState(null);
  const [premium,setPremium] = useState(false);
  const [subscription,setSubscription] = useState({plan:"free",status:"active",current_period_end:null});
  const [checkoutPlan,setCheckoutPlan] = useState(null);
  const [checkoutOrder,setCheckoutOrder] = useState(null);
  const [checkoutReady,setCheckoutReady] = useState(false);
  const [checkoutBusy,setCheckoutBusy] = useState(false);
  const [toast,setToast] = useState("");
  const [rendering,setRendering] = useState(false);
  const [renderProgress,setRenderProgress] = useState(0);
  const [user,setUser] = useState(null);
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

  useEffect(()=>{
    let mounted=true;

    (async()=>{
      try{
        await consumeAuthRedirect();
        const current=await getCurrentUser();
        if(!mounted) return;
        setUser(current);
        if(current) {
          await Promise.all([loadCloudProjects(),loadSubscription()]);
        } else {
          setProjects([]);
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
        await Promise.all([loadCloudProjects(),loadSubscription()]);
      } else {
        setProjects([]);
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

  async function saveCloudProject(title,clips){
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
          source_type:"upload",
          source_filename:title,
          status:"ready"
        })
      });
      if(!res.ok) throw new Error(await res.text());
      const created=(await res.json())?.[0];
      if(!created) return null;

      const clipRows=clips.map(c=>({
        user_id:user.id,
        project_id:created.id,
        title:c.hook,
        start_seconds:c.start,
        end_seconds:c.start+c.duration,
        score:c.score,
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
          await Promise.all([loadCloudProjects(),loadSubscription()]);
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
        await Promise.all([loadCloudProjects(),loadSubscription()]);
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
      await Promise.all([loadCloudProjects(),loadSubscription()]);
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
      setToast("6자리 인증번호를 다시 보냈습니다.");
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
      setToast("YouTube 영상 정보를 불러왔습니다.");
    }catch{
      setToast("YouTube 링크를 확인해주세요.");
    }
  }

  function onFile(f){
    if(!f) return;
    if(fileUrl) URL.revokeObjectURL(fileUrl);
    const local=URL.createObjectURL(f);
    setFile(f); setFileUrl(local); setSourceMode("upload");
    setToast("원본 영상이 준비됐습니다.");
  }

  function startProject(){
    if(!authReady) return setToast("로그인 상태를 확인하고 있습니다.");
    if(!user){
      setAuthMode("login");
      setAuthModal(true);
      return setToast("쇼츠 프로젝트를 만들려면 먼저 로그인해주세요.");
    }
    if(sourceMode==="youtube"){
      if(!ytMeta) return setToast("먼저 YouTube 링크의 영상 정보를 불러와주세요.");
      return setToast("실제 쇼츠 생성은 권리를 보유한 원본 파일을 업로드한 뒤 진행합니다.");
    }
    if(!file) return setToast("원본 영상 파일을 선택해주세요.");

    setPage("analysis");
    setAnalysis(0);
    const msgs=[
      "영상 메타데이터를 확인하는 중...",
      "장면 변화와 음성 흐름을 분석하는 중...",
      "후킹 후보를 점수화하는 중...",
      "9:16 쇼츠 프레임을 준비하는 중...",
      "미리보기 후보를 정리하는 중..."
    ];
    let p=0;
    const timer=setInterval(()=>{
      p=Math.min(100,p+8+Math.random()*8);
      setAnalysis(p);
      setAnalysisMsg(msgs[Math.min(msgs.length-1,Math.floor(p/22))]);
      if(p>=100){
        clearInterval(timer);
        const newResults=[
          {id:1,score:93,start:0,duration:15,hook:"첫 15초에서 가장 강한 장면"},
          {id:2,score:89,start:15,duration:15,hook:"분위기가 바뀌는 핵심 구간"},
          {id:3,score:85,start:30,duration:15,hook:"마지막 반응이 좋은 구간"}
        ];
        saveCloudProject(file.name,newResults);
        setResults(newResults);
        setPreview(newResults[0]);
        setTimeout(()=>setPage("results"),350);
      }
    },260);
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
      canvas.width=540; canvas.height=960;
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
        const targetRatio=9/16, sourceRatio=vw/vh;
        let sx=0,sy=0,sw=vw,sh=vh;
        if(sourceRatio>targetRatio){ sw=vh*targetRatio; sx=(vw-sw)/2; }
        else { sh=vw/targetRatio; sy=(vh-sh)/2; }

        ctx.fillStyle="#070a11";
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);

        ctx.fillStyle="rgba(0,0,0,.48)";
        ctx.fillRect(28,38,canvas.width-56,74);
        ctx.fillStyle="#fff";
        ctx.textAlign="center";
        ctx.font="700 25px system-ui";
        ctx.fillText(clip.hook.slice(0,24),canvas.width/2,82);

        ctx.fillStyle="rgba(0,0,0,.52)";
        ctx.fillRect(58,808,canvas.width-116,62);
        ctx.fillStyle="#fff";
        ctx.font="700 21px system-ui";
        ctx.fillText("WEARON VIDEO · AUTO SHORT",canvas.width/2,847);

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
          <small>로그인됨 · {String(subscription?.plan||"free").toUpperCase()}</small>
          <b>{user.email}</b>
          <button onClick={logout}>로그아웃</button>
        </> : <>
          <small>WEARON 계정</small>
          <b>프로젝트 저장을 위해 로그인하세요.</b>
          <button onClick={()=>{setAuthMode("login");setAuthStep("form");setAuthModal(true);}}>로그인 / 회원가입</button>
        </>}
      </div>
      <button className="plan" onClick={()=>setPremium(true)}>◆ 요금제 {String(subscription?.plan||"free").toUpperCase()}</button>
    </aside>

    <main className="main">
      {page==="home" && <section className="page">
        <div className="topStats"><div><span>실시간 인기</span><b>{trendStatus==="live"?"자동 갱신":"API 연결 대기"}</b></div><div><span>프로젝트</span><b>{projects.length}</b></div></div>
        <div className="hero">
          <div className="eyebrow">AI SHORTS STUDIO</div>
          <h1>긴 영상의 핵심만,<br/><em>쇼츠로 빠르게.</em></h1>
          <p>YouTube 트렌드를 실시간으로 확인하고, 권리를 보유한 원본 영상을 9:16 쇼츠로 변환합니다.</p>

          <div className="tabs">
            <button className={sourceMode==="youtube"?"on":""} onClick={()=>setSourceMode("youtube")}>🔗 YouTube 링크</button>
            <button className={sourceMode==="upload"?"on":""} onClick={()=>setSourceMode("upload")}>⇧ 원본 파일 업로드</button>
          </div>

          <div className="sourceCard">
            {sourceMode==="youtube" ? <>
              <div className="urlRow"><span>↗</span><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="YouTube 영상 URL을 붙여 넣으세요"/><button onClick={inspectYoutube}>영상 확인</button></div>
              {ytMeta && <div className="ytMeta">
                <img src={ytMeta.thumbnail} alt=""/>
                <div><b>{ytMeta.title}</b><span>{ytMeta.channelTitle}{ytMeta.viewCount ? ` · 조회수 ${fmt(ytMeta.viewCount)}`:""}</span></div>
                <button onClick={()=>{setSourceMode("upload"); fileInput.current?.click();}}>원본 파일 선택</button>
              </div>}
            </> : <>
              <label className="uploadBox">
                <input ref={fileInput} type="file" accept="video/*" hidden onChange={e=>onFile(e.target.files?.[0])}/>
                <div className="uploadIcon">⇧</div>
                <div><b>{file ? file.name : "원본 영상 파일 선택"}</b><span>본인이 소유하거나 사용 허가를 받은 파일을 선택하세요.</span></div>
                <strong onClick={()=>fileInput.current?.click()}>파일 선택</strong>
              </label>
            </>}
            <button className="convert" onClick={startProject}>쇼츠 만들기 <span>→</span></button>
            <small>실제 파일 렌더링은 로컬 업로드 영상으로 작동합니다. YouTube URL은 정보·트렌드 조회에 사용됩니다.</small>
          </div>
        </div>

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
        <div className="projectList">{projects.length ? projects.map(p=><article key={p.id}><div className="miniCover">W</div><div><h3>{p.title}</h3><p>쇼츠 {p.clips}개 · {p.createdAt}</p></div><button onClick={()=>setPage("results")}>열기</button></article>) : <div className="empty">아직 프로젝트가 없습니다.</div>}</div>
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
          ["01","원본 권리 확인","소유하거나 필요한 편집·재사용 허가를 받은 영상만 사용합니다."],
          ["02","영상 파일 업로드","브라우저가 직접 읽을 수 있는 MP4/WebM/MOV를 선택합니다."],
          ["03","후보 확인","초기 MVP에서는 15초 단위 후보를 만들고 미리보기합니다."],
          ["04","9:16 렌더링","중앙 크롭 + WEARON 오버레이를 적용해 WebM으로 다운로드합니다."]
        ].map(x=><article key={x[0]}><em>{x[0]}</em><h3>{x[1]}</h3><p>{x[2]}</p></article>)}</div>
      </section>}

      {page==="analysis" && <section className="page analysis"><div className="orb">W</div><small>WEARON AI ENGINE</small><h1>쇼츠 후보를 만들고 있습니다</h1><p>{analysisMsg}</p><div className="bar"><span style={{width:`${analysis}%`}}/></div><div className="analysisTags"><span>장면 분석</span><span>후킹 점수</span><span>9:16 프레임</span><span>미리보기</span></div></section>}

      {page==="results" && <section className="page">
        <div className="pageHead"><div><small>PROJECT RESULT</small><h1>{file?.name || "쇼츠 후보"}</h1><p>미리보기 후 실제 9:16 파일로 렌더링할 수 있습니다.</p></div><button onClick={()=>setPage("home")}>새 프로젝트</button></div>
        <div className="results">{results.length ? results.map(c=><article key={c.id}>
          <div className="portrait"><video src={fileUrl} muted preload="metadata"/><span>{c.hook}</span></div>
          <div className="resultInfo"><b className="score">편집 우선순위 {c.score}</b><h3>#{c.id} {c.hook}</h3><p>{c.start}초부터 약 {c.duration}초 · 9:16 중앙 리프레임</p></div>
          <div className="actions"><button onClick={()=>setPreview(c)}>▶ 미리보기</button><button onClick={()=>renderClip(c)}>↓ 렌더링/다운로드</button></div>
        </article>) : <div className="empty">먼저 원본 영상을 업로드해 프로젝트를 생성해주세요.</div>}</div>
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
            <button className="primary" disabled={authBusy}>{authBusy?"처리 중...":authMode==="login"?"로그인":"인증번호 받기"}</button>
          </form>
          <button className="authSwitch" onClick={()=>{setAuthMode(authMode==="login"?"signup":"login");setAuthStep("form");}}>
            {authMode==="login"?"계정이 없나요? 회원가입":"이미 계정이 있나요? 로그인"}
          </button>
          <p>{authMode==="signup"?"회원가입을 누르면 이메일로 인증번호를 보내고, 같은 창에서 인증을 완료합니다.":"가입한 이메일과 비밀번호로 로그인하세요."}</p>
        </>}
      </div>
    </div>}

    {preview && <div className="modal" onMouseDown={e=>{if(e.target===e.currentTarget)setPreview(null)}}>
      <div className="modalCard previewModal"><button className="x" onClick={()=>setPreview(null)}>✕</button>
        <div className="phone"><video src={fileUrl} controls autoPlay playsInline onLoadedMetadata={e=>{e.currentTarget.currentTime=Math.min(preview.start,e.currentTarget.duration||preview.start)}}/><div className="hook">{preview.hook}</div><div className="watermark">WEARON VIDEO</div></div>
        <div className="previewCopy"><small>SHORT PREVIEW</small><h2>#{preview.id} {preview.hook}</h2><p>브라우저에서 원본 파일을 직접 미리봅니다. 다운로드 버튼을 누르면 중앙을 9:16으로 크롭해 새 영상 파일을 생성합니다.</p><button className="primary" onClick={()=>renderClip(preview)}>↓ 9:16 렌더링/다운로드</button><button onClick={()=>setPremium(true)}>✎ PRO 편집기 보기</button></div>
      </div>
    </div>}

    {premium && <div className="modal" onMouseDown={e=>{if(e.target===e.currentTarget)setPremium(false)}}>
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
