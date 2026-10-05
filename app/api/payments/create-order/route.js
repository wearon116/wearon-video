import { NextResponse } from "next/server";
import { adminRest, planById, requireUser } from "../../../../lib/paymentServer";

function bankInfo() {
  const bank = String(process.env.BANK_NAME || "").trim();
  const account = String(process.env.BANK_ACCOUNT_NUMBER || "").trim();
  const holder = String(process.env.BANK_ACCOUNT_HOLDER || "").trim();
  if (!bank || !account || !holder) {
    throw new Error("계좌이체 받을 계좌가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.");
  }
  return { bank, account, holder };
}

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const { plan: planId } = await request.json();
    const plan = planById(planId);
    const account = bankInfo();

    const existingRes = await adminRest(
      `payment_orders?user_id=eq.${encodeURIComponent(user.id)}&plan=eq.${encodeURIComponent(plan.id)}&status=eq.pending&method=eq.bank_transfer&select=*&order=created_at.desc&limit=1`
    );
    if (existingRes.ok) {
      const existing = (await existingRes.json())?.[0];
      if (existing) {
        return NextResponse.json({
          orderId: existing.order_id,
          amount: Number(existing.amount),
          plan: existing.plan,
          orderName: `WEARON VIDEO ${plan.name} 30일 이용권`,
          paymentMethod: "bank_transfer",
          bank: account.bank,
          account: account.account,
          holder: account.holder,
          pending: true
        });
      }
    }

    const orderId = `WV_${Date.now()}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;

    const res = await adminRest("payment_orders", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: user.id,
        order_id: orderId,
        plan: plan.id,
        amount: plan.price,
        status: "pending",
        method: "bank_transfer"
      })
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    return NextResponse.json({
      orderId,
      amount: plan.price,
      plan: plan.id,
      orderName: `WEARON VIDEO ${plan.name} 30일 이용권`,
      paymentMethod: "bank_transfer",
      bank: account.bank,
      account: account.account,
      holder: account.holder,
      pending: true
    });
  } catch (error) {
    return NextResponse.json(
      { message: error?.message || "입금 주문 생성에 실패했습니다." },
      { status: 400 }
    );
  }
}
