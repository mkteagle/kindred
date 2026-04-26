"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark, Spinner } from "@/components/ui";

export default function ResetPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      // In production this would POST to a reset endpoint
      // For now, simulate success and redirect to the sent page
      const resp = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }).catch(() => null);

      // Even if the endpoint doesn't exist yet, route to the sent page
      // (prevents email enumeration — always show success)
      router.push(`/reset/sent?email=${encodeURIComponent(email)}`);
    } catch {
      // Still route to sent page to prevent email enumeration
      router.push(`/reset/sent?email=${encodeURIComponent(email)}`);
    }
  };

  return (
    <div className="reset-bg">
      <div className="reset-card field-light">
        <div className="brand-mark logo-lockup" aria-hidden="true">
          <img src="/kindred-wordmark.svg" alt="" style={{ height: 28 }} />
        </div>

        {/* Step rail */}
        <div className="step-rail">
          <span className="step-dot step-active">1</span>
          <span className="step-line" />
          <span className="step-dot step-muted">2</span>
          <span className="step-line" />
          <span className="step-dot step-muted">3</span>
        </div>

        <h2>Reset your password.</h2>
        <p className="reset-lede">
          Enter the email you sign in with. We&apos;ll send you a link to choose a new password.
        </p>

        {error && (
          <div className="alert error" style={{ marginBottom: 16 }}>
            <span className="alert-dot" />
            <div><strong>Error.</strong> {error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="reset-form">
          <div>
            <div className="field-label">
              <span>Email</span>
            </div>
            <input
              className="field-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@family.com"
              autoComplete="email"
              autoFocus
              required
            />
          </div>

          <button
            className="button primary lg"
            type="submit"
            disabled={loading}
            style={{ width: "100%" }}
          >
            {loading ? <><Spinner /> Sending&hellip;</> : "Email me the link"}
          </button>
        </form>

        <div className="reset-footer">
          <a href="/login">Back to sign in</a>
        </div>
      </div>
    </div>
  );
}
