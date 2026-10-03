import { NextResponse } from "next/server";
import { isAdminUser, requireUser } from "../../../../lib/paymentServer";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const user = await requireUser(request);
    const isAdmin = await isAdminUser(user.id);
    return NextResponse.json({
      isAdmin,
      creditsUnlimited: isAdmin,
      planLabel: isAdmin ? "ADMIN" : null
    });
  } catch {
    return NextResponse.json({ isAdmin: false }, { status: 200 });
  }
}
