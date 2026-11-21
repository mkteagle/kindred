import { NextRequest } from "next/server";
import { finishMobileSocialAuth } from "@/lib/social-auth";

export function POST(req: NextRequest) {
  return finishMobileSocialAuth(req);
}
