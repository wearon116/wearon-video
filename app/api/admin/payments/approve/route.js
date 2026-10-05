import { NextResponse } from "next/server";
import { adminRest, planById } from "../../../../../lib/paymentServer";
import { earlyBirdPack } from "../../../../../lib/plans";
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

    const pack = earlyBirdPack(order.plan);
    const paidAt = order.approved_at || new Date().toISOString();

    if (pack && order.status !== "paid") {
      const priorRes = await adminRest(
        `payment_orders?user_id=eq.${encodeURIComponent(order.user_id)}&status=eq.paid&plan=in.(early_300,early_600,early_1000)&order_id=neq.${encodeURIComponent(orderId)}&select=order_id&limit=1`
      );
      if (!priorRes.ok) throw new Error("얼리버드 구매 이력을 확인하지 못했습니다.");
      if ((await priorRes.json())?.length) {
        throw new Error("이미 얼리버드 특가를 구매한 계정입니다.");
      }
    }

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

    if (pack) {
      const existingPackRes = await adminRest(
        `credit_packs?order_id=eq.${encodeURIComponent(orderId)}&select=id,expires_at&limit=1`
      );
      if (!existingPackRes.ok) throw new Error("크레딧팩 적용 상태를 확인하지 못했습니다.");
      const existingPack = (await existingPackRes.json())?.[0];

      if (!existingPack) {
        const expiresAt = new Date(
          new Date(paidAt).getTime() + pack.validDays * 24 * 60 * 60 * 1000
        ).toISOString();

        const packRes = await adminRest("credit_packs", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            user_id: order.user_id,
            order_id: orderId,
            pack_id: pack.id,
            credits_total: pack.credits,
            credits_remaining: pack.credits,
            expires_at: expiresAt
          })
        });
        if (!packRes.ok) throw new Error("얼리버드 크레딧팩 적용에 실패했습니다.");

        return NextResponse.json({
          ok: true,
          orderId,
          productType: "credit_pack",
          credits: pack.credits,
          expiresAt
        });
      }

      return NextResponse.json({
        ok: true,
        orderId,
        productType: "credit_pack",
        credits: pack.credits,
        expiresAt: existingPack.expires_at,
        alreadyPaid: true
      });
    }

    const plan = planById(order.plan);
    const periodEnd = new Date(new Date(paidAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

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
      productType: "plan",
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
