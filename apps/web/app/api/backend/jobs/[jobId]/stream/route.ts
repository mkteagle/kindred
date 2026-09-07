import { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/oauth";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const API_KEY = process.env.API_KEY || "";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const url = `${BACKEND_URL}/jobs/${jobId}/stream`;

  // API_KEY authenticates to the backend as an admin, so it must never be
  // attached on behalf of an anonymous caller. Job streams are private.
  const session = getSessionFromRequest(req);
  if (!session?.session_token) {
    return new Response("Authentication required", { status: 401 });
  }

  const headers: Record<string, string> = {
    "X-Session-Token": session.session_token,
  };
  if (API_KEY) headers["X-API-Key"] = API_KEY;

  const backendResp = await fetch(url, { headers });

  if (!backendResp.ok || !backendResp.body) {
    return new Response("Backend error", { status: 502 });
  }

  return new Response(backendResp.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
