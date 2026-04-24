"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { BrandMark } from "@/components/ui";

function JoinContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const prefillCode = searchParams.get("code") || "";

  const [code, setCode] = useState(prefillCode);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const resp = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invite_code: code,
          username,
          display_name: displayName,
          password,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.detail || data.error || "Registration failed");
        return;
      }
      router.push("/");
    } catch {
      setError("Connection error");
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
        <h1>Join the family.</h1>
        <p>
          Enter your invite code to create an account and start browsing the family photo library.
        </p>

        {error && <p className="login-error">{error}</p>}

        <form onSubmit={handleRegister} className="login-form">
          <label className="login-field">
            <span>Invite code</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC12345"
              autoComplete="off"
              style={{ fontFamily: "var(--mono)", letterSpacing: "0.1em", fontSize: 18 }}
              required
            />
          </label>
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
            <span>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How others will see you"
              required
            />
          </label>
          <label className="login-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>
          <button
            className="button primary"
            type="submit"
            disabled={loading}
            style={{ fontSize: 16, minHeight: 50, width: "100%" }}
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
          <p className="login-hint">
            Already have an account?{" "}
            <a href="/login" className="login-link">Sign in</a>
          </p>
        </form>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="login-screen">
          <div className="login-panel">
            <h1>Join the family.</h1>
          </div>
        </div>
      }
    >
      <JoinContent />
    </Suspense>
  );
}
