"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useRef } from "react";
import { BrandMark, Spinner } from "@/components/ui";

/* ── Eye toggle icon ─────────────────────────────────────────────── */
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

/* ── Password strength ───────────────────────────────────────────── */
function getStrength(pw: string): { level: number; label: string } {
  if (!pw || pw.length < 1) return { level: 0, label: "" };
  if (pw.length < 6) return { level: 1, label: "Too short" };

  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  // Penalize common patterns
  if (/^(123|abc|password|qwerty)/i.test(pw)) score = Math.max(score - 2, 0);

  if (score <= 1) return { level: 1, label: "Too easy" };
  if (score === 2) return { level: 2, label: "Getting there" };
  if (score === 3) return { level: 3, label: "Solid" };
  return { level: 4, label: pw.length >= 16 ? "Excellent" : "Strong \u2014 nice work" };
}

function StrengthMeter({ password }: { password: string }) {
  const { level, label } = getStrength(password);
  if (!password) return null;

  return (
    <div>
      <div className="strength-meter">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`strength-segment${i <= level ? ` s-${level}` : ""}`}
          />
        ))}
      </div>
      <div className="strength-meta">
        <span className={`strength-label sl-${level}`}>{label}</span>
        <span className="strength-count">{password.length} chars</span>
      </div>
    </div>
  );
}

export default function JoinCodePage() {
  const params = useParams();
  const router = useRouter();
  const code = (params.code as string) || "";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  const strength = getStrength(password);
  const canSubmit = strength.level >= 2 && termsAccepted && name.trim() && email.trim();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      const resp = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invite_code: code,
          username: email,
          display_name: name,
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

  const togglePassword = () => {
    setShowPassword(!showPassword);
    setTimeout(() => passwordRef.current?.focus(), 0);
  };

  return (
    <div className="join-screen">
      {/* Left pane: context + household preview */}
      <div className="join-left">
        <BrandMark />

        <div style={{ marginTop: 32 }}>
          <div className="join-eyebrow">You&apos;re invited</div>
          <h1 className="join-headline">
            Join the family archive.
          </h1>
          <p className="join-lede">
            You&apos;ve been invited to view and contribute to a shared family photo library.
            Create your account to get started.
          </p>
        </div>

        {/* Household preview card */}
        <div className="household-card">
          <div className="household-card-label">Household</div>
          <div className="household-name">
            Family Archive
            <span className="household-pulse" />
          </div>
          <div className="household-inviter">
            <div className="household-avatars">
              <span>K</span>
            </div>
            <span>You were invited to join. Invite expires in 7 days.</span>
          </div>
        </div>

        <div className="join-code">
          Invite code: {code.toUpperCase()}
        </div>
      </div>

      {/* Right pane: registration form */}
      <div className="join-right field-light">
        <h2>Create your account</h2>
        <p className="join-sub">You&apos;ll use this email next time you sign in.</p>

        {error && (
          <div className="alert error" style={{ marginBottom: 16 }}>
            <span className="alert-dot" />
            <div><strong>Error.</strong> {error}</div>
          </div>
        )}

        <form onSubmit={handleRegister} className="join-form">
          <div>
            <div className="field-label">
              <span>Your name</span>
            </div>
            <input
              className="field-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Rosa Delaney"
              autoComplete="name"
              required
            />
          </div>

          <div>
            <div className="field-label">
              <span>Email</span>
            </div>
            <input
              className="field-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="rosa@family.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <div className="field-label">
              <span>Choose a password</span>
            </div>
            <div className="field-password-wrap">
              <input
                ref={passwordRef}
                className="field-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                className="field-eye"
                onClick={togglePassword}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
            <StrengthMeter password={password} />
          </div>

          <label className="join-terms">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
            />
            <span>
              I agree to the{" "}
              <a href="/terms" target="_blank">Terms of Service</a>
              {" "}and{" "}
              <a href="/privacy" target="_blank">Privacy Policy</a>.
              Your photos stay private to your household.
            </span>
          </label>

          <button
            className="button primary lg"
            type="submit"
            disabled={loading || !canSubmit}
            style={{ width: "100%" }}
          >
            {loading ? <><Spinner /> Creating account&hellip;</> : "Join the archive"}
          </button>

          <div className="join-footer">
            Already have an account?{" "}
            <a href="/login">Sign in instead</a>
          </div>
        </form>
      </div>
    </div>
  );
}
