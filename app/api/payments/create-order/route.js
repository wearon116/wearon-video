import { NextResponse } from "next/server";
import { adminRest, requireUser } from "../../../../lib/paymentServer";
import { earlyBirdPack, paidPlan, purchasableProduct } from "../../../../lib/plans";

function bankInfo() {
  const bank = String(process.env.BANK_NAME || "").trim();
  const account = String(process.env.BANK_ACCOUNT_NUMBER || "").trim();
  const holder = String(process.env.BANK_ACCOUNT_HOLDER || "").trim();
  if (!bank || !account || !holder) {
    throw new Error("계좌이체 받을 계좌가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.");
  }
  return { bank, account, holder };
}

async function requireActivePaidPlan(userId) {
  const res = await adminRest(
    `subscriptions?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=plan,current_period_end&limit=1`
  );
  if (!res.ok) throw new Error("현재 이용권을 확인할 수 없습니다.");
  const sub = (await res.json())?.[0];
  const active = sub && sub.plan !== "free" && (!sub.current_period_end || new Date(sub.current_period_end) > new Date());
  if (!active) throw new Error("얼리버드 특가는 활성 유료 이용권 보유자만 구매할 수 있습니다.");
}

async function ensureEarlyBirdAvailable(userId) {
  const res = await adminRest(
    `payment_orders?user_id=eq.${encodeURIComponent(userId)}&status=eq.paid&plan=in.(early_300,early_600,early_1000)&select=order_id&limit=1`
  );
  if (!res.ok) throw new Error("얼리버드 구매 이력을 확인할 수 없습니다.");
  if ((await res.json())?.length) {
    throw new Error("얼리버드 특가는 계정당 한 번만 구매할 수 있습니다.");
  }
}

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const { plan: productId } = await request.json();
    const product = purchasableProduct(productId);
    if (!product) throw new Error("유효하지 않은 상품입니다.");

    const plan = paidPlan(productId);
    const pack = earlyBirdPack(productId);
    if (pack) {
      await requireActivePaidPlan(user.id);
      await ensureEarlyBirdAvailable(user.id);
    }

    const account = bankInfo();

    const existingRes = await adminRest(
      `payment_orders?user_id=eq.${encodeURIComponent(user.id)}&plan=eq.${encodeURIComponent(product.id)}&status=eq.pending&method=eq.bank_transfer&select=*&order=created_at.desc&limit=1`
    );
    if (existingRes.ok) {
      const existing = (await existingRes.json())?.[0];
      if (existing) {
        return NextResponse.json({
          orderId: existing.order_id,
          amount: Number(existing.amount),
          plan: existing.plan,
          orderName: pack
            ? `WEARON VIDEO ${pack.name} 크레딧팩`
            : `WEARON VIDEO ${plan.name} 30일 이용권`,
          paymentMethod: "bank_transfer",
          productType: pack ? "credit_pack" : "plan",
          credits: product.credits,
          validDays: pack?.validDays || 30,
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
        plan: product.id,
        amount: product.price,
        status: "pending",
        method: "bank_transfer"
      })
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    return NextResponse.json({
      orderId,
      amount: product.price,
      plan: product.id,
      orderName: pack
        ? `WEARON VIDEO ${pack.name} 크레딧팩`
        : `WEARON VIDEO ${plan.name} 30일 이용권`,
      paymentMethod: "bank_transfer",
      productType: pack ? "credit_pack" : "plan",
      credits: product.credits,
      validDays: pack?.validDays || 30,
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
