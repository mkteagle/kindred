"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";
import { AvatarEditor } from "@/components/avatar-editor";
import { BACKEND } from "@/lib/constants";

interface HouseholdUser {
  id: string;
  username: string;
  display_name: string;
  role: string;
  flickr_user_id: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface Invite {
  id: string;
  code: string;
  role: string;
  expires_at: string;
  created_at: string;
}

interface ApiKey {
  id: string;
  key_prefix: string;
  name: string;
  last_used_at: string | null;
  created_at: string | null;
}

interface ResendStatus {
  configured: boolean;
  key_preview: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const [users, setUsers] = useState<HouseholdUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<{ userId: string; role: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");

  // Integrations state
  const [resendStatus, setResendStatus] = useState<ResendStatus>({ configured: false, key_preview: null });
  const [resendKeyInput, setResendKeyInput] = useState("");
  const [savingResend, setSavingResend] = useState(false);
  const [resendSaveMsg, setResendSaveMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Email invite state
  const [emailInviteOpen, setEmailInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSendResult, setEmailSendResult] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch(`${BACKEND}/users`).then((r) => r.json()),
      fetch(`${BACKEND}/invites`).then((r) => r.json()),
      fetch(`${BACKEND}/api-keys`).then((r) => r.json()),
      fetch(`${BACKEND}/settings/integrations/resend`).then((r) => r.ok ? r.json() : { configured: false, key_preview: null }),
    ])
      .then(([me, usersData, invitesData, keysData, resendData]) => {
        if (!me.loggedIn || me.role !== "admin") {
          router.push("/");
          return;
        }
        setCurrentUser({ userId: me.userId, role: me.role });
        setDisplayName(me.display_name || me.username || "");
        setAvatarUrl(me.avatar_url || null);
        setUsers(usersData.users || []);
        setInvites(invitesData.invites || []);
        setApiKeys(keysData.keys || []);
        setResendStatus(resendData);
      })
      .catch(() => router.push("/"))
      .finally(() => setLoading(false));
  }, [router]);

  const createInvite = async () => {
    setCreating(true);
    try {
      const resp = await fetch(`${BACKEND}/invites`, { method: "POST" });
      const data = await resp.json();
      if (resp.ok) {
        setInvites((prev) => [{ id: data.id || "", code: data.code, role: "member", expires_at: data.expires_at, created_at: new Date().toISOString() }, ...prev]);
      }
    } finally {
      setCreating(false);
    }
  };

  const revokeInvite = async (id: string) => {
    await fetch(`${BACKEND}/invites/${id}`, { method: "DELETE" });
    setInvites((prev) => prev.filter((i) => i.id !== id));
  };

  const removeUser = async (id: string) => {
    if (!window.confirm("Remove this member? They will lose access.")) return;
    await fetch(`${BACKEND}/users/${id}`, { method: "DELETE" });
    setUsers((prev) => prev.filter((u) => u.id !== id));
  };

  const copyInviteLink = (code: string) => {
    const link = `${window.location.origin}/join/${code}`;
    navigator.clipboard.writeText(link);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  const generateApiKey = async () => {
    setGeneratingKey(true);
    try {
      const resp = await fetch(`${BACKEND}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Default" }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setRevealedKey(data.api_key);
        setApiKeys((prev) => [data.key, ...prev]);
      }
    } finally {
      setGeneratingKey(false);
    }
  };

  const rollApiKey = async (id: string) => {
    if (!window.confirm("Regenerate this API key? The old key will stop working immediately.")) return;
    const resp = await fetch(`${BACKEND}/api-keys/${id}/roll`, { method: "POST" });
    const data = await resp.json();
    if (resp.ok) {
      setRevealedKey(data.api_key);
      setApiKeys((prev) => prev.map((k) => (k.id === id ? data.key : k)));
    }
  };

  const deleteApiKey = async (id: string) => {
    if (!window.confirm("Delete this API key? Any apps using it will lose access.")) return;
    await fetch(`${BACKEND}/api-keys/${id}`, { method: "DELETE" });
    setApiKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const copyApiKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  // ── Resend integration ────────────────────────────────────────────
  const validateResendKey = (key: string): string | null => {
    const trimmed = key.trim();
    if (!trimmed) return "API key cannot be empty.";
    if (!trimmed.startsWith("re_")) return "Resend keys start with \"re_\" — this doesn't look right.";
    if (trimmed.length < 20) return "This key looks too short. Resend keys are typically 30+ characters.";
    if (trimmed.length > 100) return "This key looks too long. Check that you haven't pasted extra characters.";
    if (/\s/.test(trimmed)) return "API keys shouldn't contain spaces.";
    return null;
  };

  const saveResendKey = async () => {
    const key = resendKeyInput.trim();
    const validationError = validateResendKey(key);
    if (validationError) {
      setResendSaveMsg({ type: "error", text: validationError });
      return;
    }
    setSavingResend(true);
    setResendSaveMsg(null);
    try {
      const resp = await fetch(`${BACKEND}/settings/integrations/resend`, {
        method: "PUT",
        headers: { "X-Integration-Secret": key },
      });
      const data = await resp.json();
      if (resp.ok) {
        setResendStatus({ configured: true, key_preview: data.key_preview });
        setResendKeyInput("");
        setResendSaveMsg({ type: "success", text: "Resend API key saved successfully." });
      } else {
        setResendSaveMsg({ type: "error", text: data.detail || "Failed to save key." });
      }
    } catch {
      setResendSaveMsg({ type: "error", text: "Could not reach the server." });
    } finally {
      setSavingResend(false);
    }
  };

  const removeResendKey = async () => {
    if (!window.confirm("Remove Resend API key? Email invites will stop working.")) return;
    try {
      await fetch(`${BACKEND}/settings/integrations/resend`, { method: "DELETE" });
      setResendStatus({ configured: false, key_preview: null });
      setResendSaveMsg({ type: "success", text: "Resend API key removed." });
    } catch {
      setResendSaveMsg({ type: "error", text: "Could not reach the server." });
    }
  };

  // ── Email invite ──────────────────────────────────────────────────
  const sendEmailInvite = async () => {
    if (!inviteEmail.trim()) return;
    setSendingEmail(true);
    setEmailSendResult(null);
    try {
      const resp = await fetch(`${BACKEND}/invites/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), name: inviteName.trim() || null }),
      });
      const data = await resp.json();
      if (resp.ok && data.email_sent) {
        setEmailSendResult({ type: "success", text: `Invite sent to ${data.email}` });
        setInvites((prev) => [
          { id: "", code: data.code, role: "member", expires_at: data.expires_at, created_at: new Date().toISOString() },
          ...prev,
        ]);
        setInviteEmail("");
        setInviteName("");
        setTimeout(() => setEmailInviteOpen(false), 2000);
      } else if (resp.ok && !data.email_sent) {
        setEmailSendResult({ type: "error", text: `Invite created (${data.code}) but email failed: ${data.email_error || "Unknown error"}` });
        setInvites((prev) => [
          { id: "", code: data.code, role: "member", expires_at: data.expires_at, created_at: new Date().toISOString() },
          ...prev,
        ]);
      } else {
        setEmailSendResult({ type: "error", text: data.detail || "Failed to send invite." });
      }
    } catch {
      setEmailSendResult({ type: "error", text: "Could not reach the server." });
    } finally {
      setSendingEmail(false);
    }
  };

  if (loading) {
    return <div className="settings-page"><Spinner /></div>;
  }

  return (
    <div className="settings-page">
      {/* Revealed API key banner */}
      {revealedKey && (
        <div className="settings-key-reveal">
          <div className="settings-key-reveal-header">
            <strong>Your new API key</strong>
            <button className="settings-key-dismiss" onClick={() => setRevealedKey(null)}>&times;</button>
          </div>
          <p className="settings-key-warning">Copy this key now — it will not be shown again.</p>
          <div className="settings-key-value">
            <code>{revealedKey}</code>
            <button className="settings-copy" onClick={() => copyApiKey(revealedKey)}>
              {keyCopied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="settings-key-hint">
            Add this to your backend <code>.env</code> file as <code>API_KEY</code>, or use it in the iOS app settings.
          </p>
        </div>
      )}

      {/* Profile avatar section */}
      <div className="settings-profile">
        <div className="settings-profile-avatar" onClick={() => setAvatarEditorOpen(true)}>
          {avatarUrl ? (
            <img
              src={`${BACKEND}${avatarUrl}?t=${Date.now()}`}
              alt={displayName}
              className="settings-profile-avatar-img"
            />
          ) : (
            <div className="settings-profile-initials" style={{ background: "linear-gradient(135deg, #c9551c, #e9b85d)" }}>
              {(displayName || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="settings-profile-avatar-overlay">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
        </div>
        <div className="settings-profile-info">
          <h2>{displayName}</h2>
          <span>Click your photo to change it</span>
        </div>
      </div>

      {avatarEditorOpen && (
        <AvatarEditor
          currentAvatarUrl={avatarUrl}
          displayName={displayName}
          onSaved={(newUrl) => setAvatarUrl(newUrl)}
          onClose={() => setAvatarEditorOpen(false)}
        />
      )}

      <div className="settings-section">
        <div className="settings-header">
          <h2>Household Members</h2>
          <span className="settings-count">{users.length}</span>
        </div>
        <div className="settings-list">
          {users.map((u) => (
            <div key={u.id} className="settings-row">
              {u.avatar_url ? (
                <img
                  src={`${BACKEND}${u.avatar_url}`}
                  alt={u.display_name}
                  className="settings-avatar"
                  style={{ objectFit: "cover" }}
                />
              ) : (
                <div className="settings-avatar">
                  {(u.display_name || u.username).charAt(0).toUpperCase()}
                </div>
              )}
              <div className="settings-info">
                <strong>{u.display_name}</strong>
                <span>@{u.username} &middot; {u.role}</span>
              </div>
              {u.id !== currentUser?.userId && (
                <button className="settings-remove" onClick={() => removeUser(u.id)}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-header">
          <h2>API Keys</h2>
          <button className="button primary" onClick={generateApiKey} disabled={generatingKey} style={{ fontSize: 13, minHeight: 36 }}>
            {generatingKey ? "Generating..." : "Generate new key"}
          </button>
        </div>
        {apiKeys.length === 0 ? (
          <p className="settings-empty">No API keys. Generate one to connect mobile apps or external tools.</p>
        ) : (
          <div className="settings-list">
            {apiKeys.map((k) => (
              <div key={k.id} className="settings-row">
                <div className="settings-code">{k.key_prefix}...&bull;&bull;&bull;&bull;</div>
                <div className="settings-info">
                  <strong>{k.name}</strong>
                  <span>
                    Created {k.created_at ? new Date(k.created_at).toLocaleDateString() : "\u2014"}
                    {k.last_used_at && ` \u00b7 Last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="settings-copy" onClick={() => rollApiKey(k.id)}>
                    Roll
                  </button>
                  <button className="settings-remove" onClick={() => deleteApiKey(k.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Integrations ─────────────────────────────────────────────── */}
      <div className="settings-section" id="integrations">
        <div className="settings-header">
          <h2>Integrations</h2>
        </div>

        <div className="integration-card">
          <div className="integration-card-header">
            <div className="integration-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </div>
            <div className="integration-card-title">
              <strong>Resend Email</strong>
              <span className={`integration-status ${resendStatus.configured ? "configured" : ""}`}>
                {resendStatus.configured ? "Configured" : "Not configured"}
              </span>
            </div>
          </div>

          <p className="integration-card-desc">
            Connect Resend to send branded invite emails directly from Kindred. Self-hosted instances configure this through the UI instead of environment variables.
          </p>

          {resendStatus.configured && resendStatus.key_preview && (
            <div className="integration-key-preview">
              <span className="integration-key-mask">{resendStatus.key_preview}</span>
              <button className="settings-remove" onClick={removeResendKey} style={{ marginLeft: "auto" }}>
                Remove
              </button>
            </div>
          )}

          <div className="integration-key-form">
            <input
              type="password"
              className="integration-key-input"
              placeholder={resendStatus.configured ? "Paste new key to replace..." : "Paste your Resend API key (re_...)"}
              value={resendKeyInput}
              onChange={(e) => setResendKeyInput(e.target.value)}
              autoComplete="off"
            />
            <button
              className="button primary"
              onClick={saveResendKey}
              disabled={savingResend || !resendKeyInput.trim()}
              style={{ fontSize: 13, minHeight: 36, flexShrink: 0 }}
            >
              {savingResend ? "Saving..." : "Save"}
            </button>
          </div>

          {resendSaveMsg && (
            <p className={`integration-msg ${resendSaveMsg.type}`}>{resendSaveMsg.text}</p>
          )}
        </div>
      </div>

      {/* ── Invite Codes ─────────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-header">
          <h2>Invite Codes</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="button primary"
              onClick={() => {
                if (!resendStatus.configured) {
                  // Scroll to integrations section
                  document.getElementById("integrations")?.scrollIntoView({ behavior: "smooth" });
                  setResendSaveMsg({ type: "error", text: "Add your Resend API key above to enable email invites." });
                  return;
                }
                setEmailInviteOpen(true);
                setEmailSendResult(null);
              }}
              style={{ fontSize: 13, minHeight: 36 }}
            >
              Invite by email
            </button>
            <button className="button primary" onClick={createInvite} disabled={creating} style={{ fontSize: 13, minHeight: 36 }}>
              {creating ? "Creating..." : "Create invite"}
            </button>
          </div>
        </div>

        {/* Email invite modal */}
        {emailInviteOpen && (
          <div className="email-invite-form">
            <div className="email-invite-form-header">
              <strong>Send email invite</strong>
              <button className="settings-key-dismiss" onClick={() => { setEmailInviteOpen(false); setEmailSendResult(null); }}>&times;</button>
            </div>
            <p className="email-invite-form-desc">
              Enter a recipient email and we will send them a branded invite with a join link.
            </p>
            <div className="email-invite-fields">
              <input
                type="email"
                className="integration-key-input"
                placeholder="Email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                autoComplete="off"
              />
              <input
                type="text"
                className="integration-key-input"
                placeholder="Name (optional)"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <button
              className="button primary"
              onClick={sendEmailInvite}
              disabled={sendingEmail || !inviteEmail.trim()}
              style={{ fontSize: 13, minHeight: 36, width: "100%", marginTop: 12 }}
            >
              {sendingEmail ? "Sending..." : "Send invite"}
            </button>
            {emailSendResult && (
              <p className={`integration-msg ${emailSendResult.type}`}>{emailSendResult.text}</p>
            )}
          </div>
        )}

        {invites.length === 0 && !emailInviteOpen ? (
          <p className="settings-empty">No active invites. Create one to invite family members.</p>
        ) : (
          <div className="settings-list">
            {invites.map((inv) => (
              <div key={inv.id || inv.code} className="settings-row">
                <div className="settings-code">{inv.code}</div>
                <div className="settings-info">
                  <span>Expires {new Date(inv.expires_at).toLocaleDateString()}</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="settings-copy" onClick={() => copyInviteLink(inv.code)}>
                    {copied === inv.code ? "Copied!" : "Copy link"}
                  </button>
                  <button className="settings-remove" onClick={() => revokeInvite(inv.id)}>
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
