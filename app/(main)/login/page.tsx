"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { BrandMark } from "@/components/ui";

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get("error");
  const [tab, setTab] = useState<"flickr" | "member">("flickr");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const handleMemberLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLoginError("");
    try {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setLoginError(data.detail || data.error || "Login failed");
        return;
      }
      router.push("/");
    } catch {
      setLoginError("Connection error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-panel">
        <div style={{ marginBottom: "auto", paddingTop: 8 }}>
          <BrandMark />
        </div>
        <h1>Welcome back.</h1>
        <p>
          Sign in to access your family photo library.
        </p>

        {(error === "denied" || loginError) && (
          <p className="login-error">
            {error === "denied"
              ? "Access denied. Your Flickr account is not authorized."
              : loginError}
          </p>
        )}

        <div className="login-tabs">
          <button
            className={`login-tab ${tab === "flickr" ? "is-active" : ""}`}
            onClick={() => setTab("flickr")}
          >
            Admin
          </button>
          <button
            className={`login-tab ${tab === "member" ? "is-active" : ""}`}
            onClick={() => setTab("member")}
          >
            Family member
          </button>
        </div>

        {tab === "flickr" ? (
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
            <p className="login-hint">
              For the account owner who connected the Flickr library.
            </p>
          </div>
        ) : (
          <form onSubmit={handleMemberLogin} className="login-form">
            <label className="login-field">
              <span>Username</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="login-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <button
              className="button primary"
              type="submit"
              disabled={loading}
              style={{ fontSize: 16, minHeight: 50, width: "100%" }}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
            <p className="login-hint">
              Got an invite code?{" "}
              <a href="/join" className="login-link">Create an account</a>
            </p>
          </form>
        )}
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
