import { NextRequest } from "next/server";
import { finishSocialAuth } from "@/lib/social-auth";

export function GET(req: NextRequest) { return finishSocialAuth(req, "google"); }
