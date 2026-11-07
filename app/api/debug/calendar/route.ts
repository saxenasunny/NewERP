import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/auth/account";
import CalendarPage from "@/app/(app)/calendar/page";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const account = await requireAccountContext();
    const result = await CalendarPage({ searchParams: Promise.resolve({}) });
    return NextResponse.json({
      ok: true,
      user: account.user.email,
      role: account.navRole,
      rendered: typeof result,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        errorName: err?.name ?? "Unknown",
        errorMessage: err?.message ?? String(err),
        errorStack: err?.stack,
        errorDigest: err?.digest,
      },
      { status: 500 },
    );
  }
}
