"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState, useRef } from "react";
import { BrandMark, Spinner } from "@/components/ui";
import { OAuthHandoff } from "@/components/oauth-handoff";

/* ── Eye toggle icon (16x16 stroked) ─────────────────────────────── */
function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get("error");
  const returnPath = searchParams.get("return");

  const [tab, setTab] = useState<"member" | "admin">("member");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [oauthHandoff, setOauthHandoff] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // If there's a return param, this is a 401/expired session flow
  const isExpired = !!returnPath;

  const handleMemberLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLoginError("");
    try {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email, password }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setLoginError(data.detail || data.error || "Login failed");
        return;
      }
      // Redirect to return path if present, otherwise home
      if (returnPath && returnPath.startsWith("/")) {
        router.push(returnPath);
      } else {
        router.push("/");
      }
    } catch {
      setLoginError("Connection error");
    } finally {
      setLoading(false);
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
    // Keep focus on the password input
    setTimeout(() => passwordRef.current?.focus(), 0);
  };

  /* ── 401 / Expired session layout ─────────────────────────────── */
  if (isExpired) {
    return (
      <div className="reset-bg">
        <div className="expired-card">
          <div className="expired-header">
            <div className="reset-icon icon-clock">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div>
              <div className="expired-meta">Session expired</div>
              <h2>Sign in again to keep going.</h2>
            </div>
          </div>

          <p className="expired-lede">
            For your family&apos;s privacy, Kindred signs you out after 14 days of inactivity.
            We&apos;ll bring you right back to the page you were on.
          </p>

          <div className="return-path-bar">
            <span className="return-path-dot" />
            <span><strong>Returning to:</strong>{" "}
              <code>{decodeURIComponent(returnPath)}</code>
            </span>
          </div>

          {loginError && <p className="login-error">{loginError}</p>}

          <form onSubmit={handleMemberLogin} className="reset-form field-light">
            <div>
              <div className="field-label">
                <span>Email</span>
              </div>
              <input
                className="field-input"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <div className="field-label">
                <span>Password</span>
              </div>
              <div className="field-password-wrap">
                <input
                  ref={passwordRef}
                  className="field-input"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  required
                />
                <button
                  type="button"
                  className="field-eye"
                  onClick={togglePasswordVisibility}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </div>

            <div className="expired-actions">
              <button
                type="button"
                className="button ghost"
                onClick={() => router.push("/")}
              >
                Take me home
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={loading}
              >
                {loading ? <><Spinner /> Signing in&hellip;</> : "Sign in & continue"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  /* ── Default login: Variation A — Editorial Dark Panel ─────────── */
  return (
    <div className="login-screen">
      <div className="login-panel">
        <div className="login-header">
          <BrandMark />
          <span className="login-eyebrow">Welcome back</span>
        </div>

        <h1 className="login-display">
          The family archive,<br />kept warm.
        </h1>

        <p className="login-lede">
          Sign in to browse, search, and share your household&apos;s photos.
          Everything is private to your family.
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
            className={`login-tab ${tab === "member" ? "is-active" : ""}`}
            onClick={() => setTab("member")}
          >
            Member
          </button>
          <button
            className={`login-tab ${tab === "admin" ? "is-active" : ""}`}
            onClick={() => setTab("admin")}
          >
            Admin
          </button>
        </div>

        {tab === "admin" ? (
          <div className="login-form">
            <button
              className="button primary lg"
              style={{ width: "100%" }}
              onClick={() => setOauthHandoff(true)}
            >
              <span className="flickr-dot" /> Sign in with Flickr
            </button>
            <p className="login-hint">
              For the account owner who connected the Flickr library.
            </p>
            {oauthHandoff && (
              <OAuthHandoff
                onClose={() => setOauthHandoff(false)}
                onContinue={() => {
                  window.location.href = "/api/auth/flickr";
                }}
              />
            )}
          </div>
        ) : (
          <form onSubmit={handleMemberLogin} className="login-form">
            <div>
              <div className="field-label">
                <span>Email</span>
              </div>
              <input
                className="field-input"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="you@family.com"
                required
              />
            </div>
            <div>
              <div className="field-label">
                <span>Password</span>
                <a href="/reset">Forgot?</a>
              </div>
              <div className="field-password-wrap">
                <input
                  ref={passwordRef}
                  className="field-input"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="field-eye"
                  onClick={togglePasswordVisibility}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </div>
            <button
              className="button primary lg"
              type="submit"
              disabled={loading}
              style={{ width: "100%" }}
            >
              {loading ? <><Spinner /> Signing in&hellip;</> : "Sign in"}
            </button>
            <p className="login-hint">
              New to your family&apos;s Kindred?{" "}
              <a href="/join" className="login-link">Use your invite link.</a>
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
            <div className="login-header">
              <BrandMark />
              <span className="login-eyebrow">Welcome back</span>
            </div>
            <h1 className="login-display">The family archive,<br />kept warm.</h1>
          </div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
