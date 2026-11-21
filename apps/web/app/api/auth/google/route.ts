import { NextRequest } from "next/server";
import { beginSocialAuth } from "@/lib/social-auth";

export function GET(req: NextRequest) { return beginSocialAuth(req, "google"); }
