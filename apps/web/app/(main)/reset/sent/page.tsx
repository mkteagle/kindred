"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect, useCallback } from "react";
import { Spinner } from "@/components/ui";

const COOLDOWN_SECONDS = 60;

function SentContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);

  // Check sessionStorage for existing cooldown
  useEffect(() => {
    const key = `reset_cooldown_${email}`;
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const remaining = Math.max(0, Math.ceil((parseInt(stored, 10) - Date.now()) / 1000));
      if (remaining > 0) {
        setCooldown(remaining);
      }
    }
  }, [email]);

  // Countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = useCallback(async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    try {
      await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }).catch(() => null);
    } finally {
      setResending(false);
      // Start cooldown
      const key = `reset_cooldown_${email}`;
      sessionStorage.setItem(key, String(Date.now() + COOLDOWN_SECONDS * 1000));
      setCooldown(COOLDOWN_SECONDS);
    }
  }, [email, cooldown, resending]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="reset-bg">
      <div className="reset-card reset-card-center field-light">
        <div className="brand-mark logo-lockup" aria-hidden="true" style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          <img src="/kindred-wordmark.svg" alt="" style={{ height: 28 }} />
        </div>

        {/* Step rail */}
        <div className="step-rail">
          <span className="step-dot step-done">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span className="step-line" />
          <span className="step-dot step-active">2</span>
          <span className="step-line" />
          <span className="step-dot step-muted">3</span>
        </div>

        {/* Mail icon */}
        <div className="reset-icon icon-mail">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M22 7l-10 7L2 7" />
          </svg>
        </div>

        <h2>Check your inbox.</h2>
        <p className="reset-lede">
          We sent a reset link to <strong>{email}</strong>.
          The link expires in <strong>30 minutes</strong>.
        </p>

        {/* Info alert */}
        <div className="alert info" style={{ marginBottom: 20, textAlign: "left" }}>
          <span className="alert-dot" />
          <div>
            <strong>No email?</strong> If it doesn&apos;t arrive in a couple of minutes,
            check your spam folder or try a different email address.
          </div>
        </div>

        {/* Resend button */}
        <button
          className="button ghost"
          onClick={handleResend}
          disabled={cooldown > 0 || resending}
          style={{ width: "100%", marginBottom: 16 }}
        >
          {resending ? (
            <><Spinner /> Resending&hellip;</>
          ) : cooldown > 0 ? (
            `Resend in ${formatTime(cooldown)}`
          ) : (
            "Resend email"
          )}
        </button>

        <div className="reset-footer">
          Wrong email?{" "}
          <a href="/reset">Try again</a>
        </div>
      </div>
    </div>
  );
}

export default function ResetSentPage() {
  return (
    <Suspense
      fallback={
        <div className="reset-bg">
          <div className="reset-card reset-card-center">
            <h2>Check your inbox.</h2>
          </div>
        </div>
      }
    >
      <SentContent />
    </Suspense>
  );
}
