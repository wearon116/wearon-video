import { NextResponse } from "next/server";
import { adminRest, requireUser } from "../../../../lib/paymentServer";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const user = await requireUser(request);
    const res = await adminRest(
      `admin_users?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`
    );

    if (!res.ok) {
      return NextResponse.json({ isAdmin: false }, { status: 200 });
    }

    const rows = await res.json();
    return NextResponse.json({ isAdmin: Boolean(rows?.length) });
  } catch {
    return NextResponse.json({ isAdmin: false }, { status: 200 });
  }
}
