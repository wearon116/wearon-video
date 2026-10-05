import { NextResponse } from "next/server";
import { adminRest, requireUser } from "../../../../lib/paymentServer";
import { earlyBirdPack } from "../../../../lib/plans";

export async function GET(request) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");
    if (!orderId) throw new Error("주문번호가 필요합니다.");

    const res = await adminRest(
      `payment_orders?order_id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(user.id)}&select=order_id,plan,status,approved_at&limit=1`
    );
    if (!res.ok) throw new Error("주문 상태를 확인할 수 없습니다.");

    const order = (await res.json())?.[0];
    if (!order) throw new Error("주문을 찾을 수 없습니다.");

    const pack = earlyBirdPack(order.plan);
    let packData = null;
    if (pack && order.status === "paid") {
      const packRes = await adminRest(
        `credit_packs?order_id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(user.id)}&select=pack_id,credits_total,credits_remaining,expires_at&limit=1`
      );
      if (packRes.ok) packData = (await packRes.json())?.[0] || null;
    }

    return NextResponse.json({
      ok: true,
      orderId: order.order_id,
      productId: order.plan,
      productType: pack ? "credit_pack" : "plan",
      status: order.status,
      approvedAt: order.approved_at,
      creditPack: packData
    });
  } catch (error) {
    return NextResponse.json(
      { message: error?.message || "주문 상태 확인에 실패했습니다." },
      { status: 400 }
    );
  }
}
