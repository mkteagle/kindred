import { NextRequest } from "next/server";
import { beginAppleCallback, finishSocialAuth } from "@/lib/social-auth";

export const runtime = "nodejs";
export function POST(req: NextRequest) { return beginAppleCallback(req); }
export function GET(req: NextRequest) { return finishSocialAuth(req, "apple"); }
