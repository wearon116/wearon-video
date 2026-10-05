import { NextResponse } from "next/server";
import { adminRest, planById } from "../../../../../lib/paymentServer";
import { requireAdmin } from "../../../../../lib/adminServer";

export async function POST(request) {
  try {
    await requireAdmin(request);
    const { orderId } = await request.json();

    if (!orderId) throw new Error("주문번호가 필요합니다.");

    const orderRes = await adminRest(
      `payment_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`
    );
    if (!orderRes.ok) throw new Error("주문 정보를 확인할 수 없습니다.");

    const order = (await orderRes.json())?.[0];
    if (!order) throw new Error("주문을 찾을 수 없습니다.");
    if (order.method !== "bank_transfer") {
      throw new Error("계좌이체 주문만 수동 승인할 수 있습니다.");
    }

    const plan = planById(order.plan);
    const paidAt = order.approved_at || new Date().toISOString();
    const periodEnd = new Date(new Date(paidAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    if (order.status !== "paid") {
      const paymentUpdate = await adminRest(
        `payment_orders?order_id=eq.${encodeURIComponent(orderId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: "paid",
            method: "bank_transfer",
            approved_at: paidAt,
            updated_at: new Date().toISOString()
          })
        }
      );
      if (!paymentUpdate.ok) throw new Error("입금 승인 기록 저장에 실패했습니다.");
    }

    const subRes = await adminRest("subscriptions?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        user_id: order.user_id,
        provider: "bank_transfer",
        plan: plan.id,
        status: "active",
        current_period_end: periodEnd,
        updated_at: new Date().toISOString()
      })
    });
    if (!subRes.ok) throw new Error("이용권 활성화에 실패했습니다.");

    return NextResponse.json({
      ok: true,
      orderId,
      plan: plan.id,
      currentPeriodEnd: periodEnd,
      alreadyPaid: order.status === "paid"
    });
  } catch (error) {
    return NextResponse.json(
      { message: error?.message || "입금 승인 처리에 실패했습니다." },
      { status: error?.status || 400 }
    );
  }
}
