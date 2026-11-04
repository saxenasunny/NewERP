import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth/account";
import { importKindSchema, importTemplate } from "@/modules/imports/import-service";

/**
 * CSV template download. Requires an import permission; templates contain no
 * tenant data, but the route is not public so navigation never dangles.
 */
export async function GET(request: Request) {
  const account = await getAccountContext();
  if (!account) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "Sign in first." },
      { status: 401 },
    );
  }

  const kindParam = new URL(request.url).searchParams.get("kind") ?? "USERS";
  const parsed = importKindSchema.safeParse(kindParam);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_KIND", message: "Unknown import kind." },
      { status: 400 },
    );
  }

  const allowed =
    parsed.data === "USERS"
      ? account.permissions.has("users.import")
      : account.permissions.has("enrolments.manage");
  if (!allowed) {
    return NextResponse.json({ code: "FORBIDDEN", message: "Not permitted." }, { status: 403 });
  }

  return new NextResponse(importTemplate(parsed.data), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${parsed.data.toLowerCase()}-template.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
