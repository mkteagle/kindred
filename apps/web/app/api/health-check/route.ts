import { NextResponse } from "next/server";
import { BACKEND_URL, CATALOG_BACKEND_URL } from "@/lib/backend-url";
import { getHealthReport } from "@/lib/health-check";
import { getSessionFromRequest } from "@/lib/oauth";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Sign in to view service health." }, { status: 401, headers });

  const report = await getHealthReport({
    catalog: CATALOG_BACKEND_URL,
    nas: BACKEND_URL,
    vercelRuntime: process.env.VERCEL === "1",
    sessionToken: session.session_token,
  });
  return NextResponse.json(report, { headers });
}
