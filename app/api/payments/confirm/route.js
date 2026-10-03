import { NextResponse } from "next/server";
import { adminRest, requireUser, tossAuthHeader } from "../../../../lib/paymentServer";

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const { paymentKey, orderId, amount } = await request.json();

    if (!paymentKey || !orderId || !Number.isInteger(Number(amount))) {
      throw new Error("결제 정보가 올바르지 않습니다.");
    }

    const orderRes = await adminRest(
      `payment_orders?order_id=eq.${encodeURIComponent(orderId)}&user_id=eq.${user.id}&select=*`
    );

    if (!orderRes.ok) throw new Error("주문 정보를 확인할 수 없습니다.");
    const rows = await orderRes.json();
    const order = rows?.[0];

    if (!order) throw new Error("일치하는 주문이 없습니다.");
    if (order.status === "paid") {
      return NextResponse.json({ ok: true, plan: order.plan, alreadyPaid: true });
    }
    if (Number(order.amount) !== Number(amount)) {
      throw new Error("결제 금액이 주문 금액과 일치하지 않습니다.");
    }

    const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: tossAuthHeader(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount: Number(order.amount)
      })
    });

    const tossData = await tossRes.json();
    if (!tossRes.ok) {
      await adminRest(`payment_orders?order_id=eq.${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "failed",
          updated_at: new Date().toISOString()
        })
      });
      throw new Error(tossData?.message || "토스페이먼츠 결제 승인에 실패했습니다.");
    }

    const paidAt = tossData.approvedAt || new Date().toISOString();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const updateRes = await adminRest(
      `payment_orders?order_id=eq.${encodeURIComponent(orderId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "paid",
          payment_key: paymentKey,
          method: typeof tossData.method === "string" ? tossData.method : null,
          approved_at: paidAt,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!updateRes.ok) throw new Error("결제 기록 저장에 실패했습니다.");

    const subRes = await adminRest("subscriptions?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        user_id: user.id,
        provider: "toss",
        plan: order.plan,
        status: "active",
        current_period_end: periodEnd,
        updated_at: new Date().toISOString()
      })
    });

    if (!subRes.ok) throw new Error("요금제 적용에 실패했습니다.");

    return NextResponse.json({
      ok: true,
      plan: order.plan,
      currentPeriodEnd: periodEnd
    });
  } catch (error) {
    return NextResponse.json(
      { message: error?.message || "결제 승인 처리에 실패했습니다." },
      { status: 400 }
    );
  }
}
