import { NextRequest, NextResponse } from "next/server";

// Browsers request this conventional URL even when metadata names an SVG.
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/brand/kindred-app-icon.svg", request.url));
}
