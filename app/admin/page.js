"use client";

import { useEffect, useState } from "react";
import { getCurrentUser, getSession } from "../../lib/supabaseAuth";

function won(value = 0) {
  return new Intl.NumberFormat("ko-KR").format(Number(value || 0)) + "원";
}

function dateText(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("ko-KR");
  } catch {
    return "-";
  }
}

export default function AdminPage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("checking");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState("users");
  const [password, setPassword] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);

  async function load() {
    try {
      setStatus("loading");
      setMessage("");

      const user = await getCurrentUser();
      if (!user) {
        setStatus("error");
        setMessage("먼저 WEARON VIDEO에 로그인해주세요.");
        return;
      }

      const session = await getSession();
      if (!session?.access_token) throw new Error("로그인 세션이 없습니다.");

      const res = await fetch("/api/admin/dashboard", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store"
      });
      const body = await res.json();

      if (res.status === 401 && body?.message?.includes("비밀번호")) {
        setStatus("locked");
        setData(null);
        return;
      }

      if (!res.ok) throw new Error(body?.message || "관리자 데이터를 불러오지 못했습니다.");

      setData(body);
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setMessage(error?.message || "관리자 페이지를 불러오지 못했습니다.");
    }
  }

  async function checkAccess() {
    try {
      const res = await fetch("/api/admin/access", { cache: "no-store" });
      const body = await res.json();
      if (body?.unlocked) return load();
      setStatus("locked");
    } catch {
      setStatus("locked");
    }
  }

  async function unlock(e) {
    e.preventDefault();
    if (!password) return;

    try {
      setUnlockBusy(true);
      setMessage("");

      const res = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const body = await res.json();

      if (!res.ok) {
        setMessage(body?.message || "비밀번호가 올바르지 않습니다.");
        return;
      }

      setPassword("");
      await load();
    } catch {
      setMessage("관리자 인증 중 오류가 발생했습니다.");
    } finally {
      setUnlockBusy(false);
    }
  }

  async function lockAdmin() {
    try {
      await fetch("/api/admin/access", { method: "DELETE" });
    } finally {
      setData(null);
      setPassword("");
      setMessage("");
      setStatus("locked");
    }
  }

  useEffect(() => {
    checkAccess();
  }, []);

  if (status === "checking" || status === "loading") {
    return <main className="adminShell"><div className="adminState">관리자 데이터를 불러오는 중...</div></main>;
  }

  if (status === "locked") {
    return <main className="adminShell">
      <div className="adminLockCard">
        <div className="adminLogo">W</div>
        <small>WEARON VIDEO · ADMIN</small>
        <h1>관리자 비밀번호</h1>
        <p>관리자 페이지에 접근하려면 비밀번호를 입력하세요.</p>
        <form onSubmit={unlock}>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="비밀번호 입력"
            autoFocus
            autoComplete="current-password"
          />
          <button type="submit" disabled={unlockBusy || !password}>
            {unlockBusy ? "확인 중..." : "관리자 페이지 열기"}
          </button>
        </form>
        {message && <div className="adminLockError">{message}</div>}
        <a href="/">WEARON VIDEO로 돌아가기</a>
      </div>
    </main>;
  }

  if (status === "error") {
    return <main className="adminShell">
      <div className="adminState">
        <div className="adminLogo">W</div>
        <h1>관리자 페이지</h1>
        <p>{message}</p>
        <div className="adminStateActions">
          <a href="/">WEARON VIDEO로 돌아가기</a>
          <button onClick={load}>다시 확인</button>
        </div>
      </div>
    </main>;
  }

  const stats = data?.stats || {};
  const users = data?.users || [];
  const payments = data?.payments || [];
  const projects = data?.projects || [];

  return <main className="adminShell">
    <header className="adminTop">
      <div className="adminBrand">
        <div className="adminLogo">W</div>
        <div><b>WEARON VIDEO</b><span>ADMIN CONSOLE</span></div>
      </div>
      <div className="adminTopActions">
        <span className={data?.mode === "test" ? "modeBadge test" : "modeBadge live"}>
          {data?.mode === "test" ? "TEST 결제" : "LIVE 결제"}
        </span>
        <button onClick={load}>새로고침</button>
        <button onClick={lockAdmin}>관리자 잠금</button>
        <a href="/">사이트 보기</a>
      </div>
    </header>

    <section className="adminBody">
      <div className="adminTitle">
        <div><small>OVERVIEW</small><h1>운영 현황</h1><p>회원, 결제, 요금제, 프로젝트를 한 번에 확인합니다.</p></div>
        <div className="adminUser"><small>관리자 계정</small><b>{data?.admin?.email || "-"}</b></div>
      </div>

      <div className="adminStats">
        <article><span>전체 회원</span><b>{stats.users || 0}</b><small>가입 계정</small></article>
        <article><span>유료 이용자</span><b>{stats.activePaidUsers || 0}</b><small>활성 유료 플랜</small></article>
        <article><span>전체 프로젝트</span><b>{stats.projects || 0}</b><small>저장 프로젝트</small></article>
        <article><span>{data?.mode === "test" ? "테스트 결제액" : "누적 결제액"}</span><b>{won(stats.paidTotal || 0)}</b><small>{data?.mode === "test" ? "실제 정산 아님" : "승인 완료 기준"}</small></article>
      </div>

      <nav className="adminTabs">
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>회원 {users.length}</button>
        <button className={tab === "payments" ? "active" : ""} onClick={() => setTab("payments")}>결제 {payments.length}</button>
        <button className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}>프로젝트 {projects.length}</button>
      </nav>

      <section className="adminPanel">
        {tab === "users" && <>
          <div className="adminPanelHead"><div><small>MEMBERS</small><h2>회원 관리</h2></div></div>
          <div className="adminTableWrap"><table className="adminTable">
            <thead><tr><th>회원</th><th>요금제</th><th>상태</th><th>프로젝트</th><th>가입일</th><th>이용기간</th></tr></thead>
            <tbody>{users.map(u => <tr key={u.id}>
              <td><b>{u.name || "이름 미등록"}</b><span>{u.email || "-"}</span></td>
              <td><strong className="planPill">{String(u.plan || "free").toUpperCase()}</strong></td>
              <td><span className={u.confirmedAt ? "statusPill ok" : "statusPill warn"}>{u.confirmedAt ? "인증완료" : "미인증"}</span></td>
              <td>{u.projects || 0}개</td>
              <td>{dateText(u.createdAt)}</td>
              <td>{u.currentPeriodEnd ? dateText(u.currentPeriodEnd) : "-"}</td>
            </tr>)}</tbody>
          </table></div>
        </>}

        {tab === "payments" && <>
          <div className="adminPanelHead"><div><small>PAYMENTS</small><h2>결제 내역</h2></div><span>{data?.mode === "test" ? "현재 테스트 결제 환경" : "라이브 결제 환경"}</span></div>
          <div className="adminTableWrap"><table className="adminTable">
            <thead><tr><th>주문번호</th><th>요금제</th><th>금액</th><th>상태</th><th>결제수단</th><th>승인일</th></tr></thead>
            <tbody>{payments.map(p => <tr key={p.order_id}>
              <td><code>{p.order_id}</code></td>
              <td><strong className="planPill">{String(p.plan || "").toUpperCase()}</strong></td>
              <td><b>{won(p.amount)}</b></td>
              <td><span className={p.status === "paid" ? "statusPill ok" : p.status === "failed" ? "statusPill bad" : "statusPill warn"}>{p.status}</span></td>
              <td>{p.method || "-"}</td>
              <td>{dateText(p.approved_at || p.created_at)}</td>
            </tr>)}</tbody>
          </table></div>
        </>}

        {tab === "projects" && <>
          <div className="adminPanelHead"><div><small>PROJECTS</small><h2>프로젝트 현황</h2></div></div>
          <div className="adminTableWrap"><table className="adminTable">
            <thead><tr><th>프로젝트</th><th>상태</th><th>생성일</th><th>프로젝트 ID</th></tr></thead>
            <tbody>{projects.map(p => <tr key={p.id}>
              <td><b>{p.title || "제목 없음"}</b></td>
              <td><span className="statusPill">{p.status}</span></td>
              <td>{dateText(p.created_at)}</td>
              <td><code>{p.id}</code></td>
            </tr>)}</tbody>
          </table></div>
        </>}
      </section>
    </section>
  </main>;
}
