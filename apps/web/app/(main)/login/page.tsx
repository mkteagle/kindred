"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { passkeyError, signInWithPasskey, usePasskeySupport } from "@/lib/passkeys";

const ERRORS: Record<string, string> = {
  account_not_linked: "This account is not linked yet. Sign in with your existing password or legacy Flickr login, then connect Google or Apple in Integrations. New members need an invitation.",
  oauth_cancelled: "Sign-in was cancelled. You can try again whenever you’re ready.",
  provider_unavailable: "This sign-in provider has not been configured on this Kindred server.",
  oauth_expired: "That sign-in request expired. Please try again.",
  oauth_state: "This sign-in request no longer matches your browser session. Start again from the Kindred login page.",
  oauth_exchange: "The provider couldn’t complete sign-in. Ask your library owner to check the provider settings.",
  oauth_backend: "Kindred couldn’t reach its account service. Try again in a moment.",
  oauth_provider: "The provider declined the sign-in request.",
  apple_requires_https: "Apple sign-in requires Kindred’s registered HTTPS address. You can sign in here with Google or your Kindred password.",
  account_access: "This provider couldn’t be connected to your Kindred account. Check the account or invitation and try again.",
};
function LoginForm() {
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const supportsPasskeys = usePasskeySupport();
  const providers = useQuery({ queryKey: ["auth-providers"], queryFn: async () => {
    const response = await fetch("/api/auth/providers");
    if (!response.ok) throw new Error("Could not load sign-in options");
    return response.json() as Promise<{ google: boolean; apple: boolean }>;
  }});
  const rawReturn = params.get("return");
  const returnPath = rawReturn?.startsWith("/") && !rawReturn.startsWith("//") && !rawReturn.includes("\\") && !/[\u0000-\u0020\u007f]/.test(rawReturn) ? rawReturn : "/gallery";
  const socialQuery = new URLSearchParams({ return: returnPath });
  if (params.get("invite")) socialQuery.set("invite", params.get("invite")!);
  const queryError = params.get("error");
  const message = error || (queryError ? ERRORS[queryError] || "We couldn’t complete sign-in. Please try again." : "");
  async function signInWithDevice() {
    setPasskeyBusy(true);
    setError("");
    try {
      await signInWithPasskey();
      window.location.assign(returnPath);
    } catch (error) {
      setError(passkeyError(error));
    } finally {
      setPasskeyBusy(false);
    }
  }
  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await response.json();
      if (!response.ok) { setError(data.detail || "Check your username and password and try again."); return; }
      window.location.assign(returnPath);
    } catch { setError("We couldn’t reach your Kindred server. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="kr-login-layout">
    <aside className="kr-login-story"><Link href="/" aria-label="Kindred home"><img src="/brand/kindred-wordmark-dark.svg" width="171" height="46" alt="Kindred" /></Link>
      <div className="kr-login-story-copy"><span className="kr-overline">THE GOOD STUFF, TOGETHER.</span><h1>Life happens.<br/>Keep it close.</h1><p>A home for the moments you never want to lose.</p></div>
      <div className="kr-login-photo"><img src="/demo/photos/family-campfire-1.jpg" alt="A family together around a campfire" /><span>Big adventures. Little everyday things.</span></div>
      <p className="kr-login-privacy">Your server. Your people. Your memories.</p>
    </aside>
    <main className="kr-login-main"><Link className="kr-back" href="/">← Back to Kindred</Link><div className="kr-login-form">
      <img className="kr-login-mark" src="/brand/kindred-mark.svg" width="46" height="46" alt="" />
      <h2>{rawReturn ? "Welcome back." : "Your people. Your place."}</h2><p>Sign in to your Kindred library.</p>
      {message && <div className="kr-auth-error" role="alert">{message}</div>}
      {(supportsPasskeys || providers.data?.google || providers.data?.apple) && <><div className="kr-social-buttons">
        {supportsPasskeys && <button type="button" disabled={passkeyBusy || busy} onClick={() => void signInWithDevice()}>{passkeyBusy ? "Waiting for passkey…" : "Sign in with a passkey"}</button>}
        {providers.data?.google && <a href={`/api/auth/google?${socialQuery}`}><span className="kr-google-g">G</span> Continue with Google</a>}
        {providers.data?.apple && <a href={`/api/auth/apple?${socialQuery}`}><svg width="19" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.3 1.2c.2 1.4-.4 2.8-1.2 3.7-.9 1-2.2 1.6-3.5 1.5-.2-1.3.4-2.7 1.2-3.6.9-1 2.3-1.6 3.5-1.6zM20 17.4c-.5 1.1-.8 1.7-1.5 2.7-.9 1.3-2.2 3-3.8 3-1.4 0-1.8-.9-3.7-.9s-2.3.9-3.7.9c-1.6 0-2.8-1.5-3.7-2.8C1 16.6.5 11.5 2.2 8.9c1.2-1.9 3.1-3 4.9-3 1.5 0 2.5.9 3.8.9 1.2 0 2.1-.9 3.8-.9 1.5 0 3.1.8 4.3 2.1-3.8 2.1-3.2 7.5 1 9.4z"/></svg> Continue with Apple</a>}
      </div><div className="kr-auth-divider"><span>or use your password</span></div></>}
      <form onSubmit={signIn}>
        <label>Username or email<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></label>
        <label>Password<span className="kr-password"><input autoComplete="current-password" type={visible ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} required /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? "Hide" : "Show"}</button></span></label>
        <Link className="kr-forgot" href="/reset">Forgot password?</Link>
        <button className="kr-primary" type="submit" disabled={busy || passkeyBusy}>{busy ? "Signing in…" : "Sign in →"}</button>
      </form>
      <p className="kr-invite-note">Joining a family library? Use the invitation your library owner sent you.</p>
      <details className="kr-legacy-login"><summary>Already use Flickr to sign in?</summary><p>Use your existing sign-in once, then connect Google or Apple in Integrations.</p><a href="/api/auth/flickr">Use existing Flickr sign-in →</a></details>
    </div><footer><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/docs">Help</Link></footer></main>
  </div>;
}
export default function LoginPage() { return <div className="kx kr-public"><Suspense fallback={<p className="kr-loading" role="status">Opening Kindred…</p>}><LoginForm /></Suspense></div>; }
