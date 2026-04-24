import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const API_KEY = process.env.API_KEY || "";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { photos } = body;
    if (!photos?.length) {
      return NextResponse.json({ error: "No photos provided" }, { status: 400 });
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (API_KEY) headers["X-API-Key"] = API_KEY;

    const backendResp = await fetch(`${BACKEND_URL}/analyze`, {
      method: "POST",
      headers,
      body: JSON.stringify({ photos }),
    });

    const result = await backendResp.json();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
