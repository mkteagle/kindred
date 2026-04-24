"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BrandMark } from "@/components/ui";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  return (
    <div className="login-screen">
      <div className="login-panel">
        <div style={{ marginBottom: "auto", paddingTop: 8 }}>
          <BrandMark />
        </div>
        <h1>Welcome back.</h1>
        <p>
          Sign in with your Flickr account to access your private family photo
          library. Only authorized family members can use Kindred.
        </p>
        {error === "denied" && (
          <p
            style={{
              color: "#ff6b6b",
              background: "rgba(255, 107, 107, .12)",
              border: "1px solid rgba(255, 107, 107, .3)",
              borderRadius: 8,
              padding: "12px 16px",
              margin: "0 0 20px",
              maxWidth: 590,
              fontSize: 15,
            }}
          >
            Access denied. Your Flickr account is not authorized to use this app.
          </p>
        )}
        <div>
          <button
            className="button primary"
            style={{ fontSize: 16, minHeight: 50, padding: "0 28px" }}
            onClick={() => {
              window.location.href = "/api/auth/flickr";
            }}
          >
            Sign in with Flickr
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="login-screen">
          <div className="login-panel">
            <h1>Welcome back.</h1>
          </div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
