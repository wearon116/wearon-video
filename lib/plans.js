export const WEARON_PLANS = {
  free: {
    id: "free",
    name: "FREE",
    price: 0,
    credits: 3,
    description: "가볍게 시작하는 무료 플랜"
  },
  starter: {
    id: "starter",
    name: "STARTER",
    price: 9900,
    credits: 30,
    description: "개인 크리에이터용"
  },
  pro: {
    id: "pro",
    name: "PRO",
    price: 19900,
    credits: 100,
    description: "꾸준히 쇼츠를 만드는 사용자용"
  },
  business: {
    id: "business",
    name: "BUSINESS",
    price: 49000,
    credits: 300,
    description: "팀·브랜드 운영용"
  }
};

export function paidPlan(id) {
  const plan = WEARON_PLANS[id];
  return plan && plan.price > 0 ? plan : null;
}
