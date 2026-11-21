import { NextRequest } from "next/server";
import { beginSocialAuth } from "@/lib/social-auth";

export const runtime = "nodejs";
export function GET(req: NextRequest) { return beginSocialAuth(req, "apple"); }
