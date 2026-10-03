import { NextResponse } from "next/server";
import { adminRest, planById, requireUser } from "../../../../lib/paymentServer";

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const { plan: planId } = await request.json();
    const plan = planById(planId);

    const orderId = `WV_${Date.now()}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;

    const res = await adminRest("payment_orders", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: user.id,
        order_id: orderId,
        plan: plan.id,
        amount: plan.price,
        status: "pending"
      })
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    return NextResponse.json({
      orderId,
      amount: plan.price,
      plan: plan.id,
      orderName: `WEARON VIDEO ${plan.name} 30일 이용권`
    });
  } catch (error) {
    return NextResponse.json(
      { message: error?.message || "결제 주문 생성에 실패했습니다." },
      { status: 400 }
    );
  }
}
