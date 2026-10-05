import { NextResponse } from "next/server";
import { adminRest } from "../../../../lib/paymentServer";
import { adminAuthUsers, requireAdmin } from "../../../../lib/adminServer";

async function readJson(res, fallback = []) {
  if (!res.ok) throw new Error(await res.text());
  return res.json().catch(() => fallback);
}

export async function GET(request) {
  try {
    const admin = await requireAdmin(request);

    const [authUsers, profilesRes, subscriptionsRes, paymentsRes, projectsRes] = await Promise.all([
      adminAuthUsers(),
      adminRest("profiles?select=id,display_name,created_at&order=created_at.desc&limit=200"),
      adminRest("subscriptions?select=user_id,plan,status,current_period_end,updated_at&order=updated_at.desc&limit=200"),
      adminRest("payment_orders?select=user_id,order_id,plan,amount,status,method,approved_at,created_at&order=created_at.desc&limit=200"),
      adminRest("projects?select=id,user_id,title,status,created_at&order=created_at.desc&limit=200")
    ]);

    const [profiles, subscriptions, payments, projects] = await Promise.all([
      readJson(profilesRes),
      readJson(subscriptionsRes),
      readJson(paymentsRes),
      readJson(projectsRes)
    ]);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    const subMap = new Map((subscriptions || []).map(s => [s.user_id, s]));
    const projectCounts = new Map();
    for (const project of projects || []) {
      projectCounts.set(project.user_id, (projectCounts.get(project.user_id) || 0) + 1);
    }

    const users = (authUsers || []).map(u => {
      const sub = subMap.get(u.id);
      const profile = profileMap.get(u.id);
      return {
        id: u.id,
        email: u.email || "",
        name: profile?.display_name || u.user_metadata?.full_name || "",
        confirmedAt: u.email_confirmed_at || u.confirmed_at || null,
        createdAt: u.created_at || profile?.created_at || null,
        plan: sub?.plan || "free",
        subscriptionStatus: sub?.status || "active",
        currentPeriodEnd: sub?.current_period_end || null,
        projects: projectCounts.get(u.id) || 0
      };
    });

    const userMap = new Map(users.map(u => [u.id, u]));
    const paymentRows = (payments || []).map(p => {
      const member = userMap.get(p.user_id);
      return {
        ...p,
        email: member?.email || "",
        name: member?.name || ""
      };
    });
    const paidPayments = paymentRows.filter(p => p.status === "paid");
    const paidTotal = paidPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const activePaidUsers = (subscriptions || []).filter(s => s.status === "active" && s.plan !== "free").length;
    const mode = "bank_transfer";

    return NextResponse.json({
      admin: { id: admin.id, email: admin.email || "" },
      mode,
      stats: {
        users: users.length,
        activePaidUsers,
        projects: (projects || []).length,
        paidTotal
      },
      users,
      payments: paymentRows,
      projects: projects || []
    });
  } catch (error) {
    return NextResponse.json(
      { message: error?.message || "관리자 데이터를 불러오지 못했습니다." },
      { status: error?.status || 400 }
    );
  }
}
