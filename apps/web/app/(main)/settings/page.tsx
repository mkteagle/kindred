"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AvatarEditor } from "@/components/avatar-editor";
import { BACKEND, fmt } from "@/lib/constants";
import { useLibraryCounts } from "@/components/kx/use-library";

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

const JOINED = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

/** "expires in 6 days" — how the design writes an invite's remaining life. */
function expiresIn(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (Number.isNaN(days)) return "expiry unknown";
  if (days < 0) return "expired";
  if (days === 0) return "expires today";
  return `expires in ${days} day${days === 1 ? "" : "s"}`;
}

function lastUsed(iso: string | null): string {
  if (!iso) return "never used";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "never used" : `last used ${date.toLocaleDateString()}`;
}

export default function SettingsPage() {
  const router = useRouter();
  const [users, setUsers] = useState<HouseholdUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<{ userId: string; role: string; username: string } | null>(null);
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

  const { data: counts } = useLibraryCounts();

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch(`${BACKEND}/users`).then((r) => r.json()),
      fetch(`${BACKEND}/invites`).then((r) => r.json()),
      fetch(`${BACKEND}/api-keys`).then((r) => r.json()),
      fetch(`${BACKEND}/settings/integrations/resend`).then((r) =>
        r.ok ? r.json() : { configured: false, key_preview: null },
      ),
    ])
      .then(([me, usersData, invitesData, keysData, resendData]) => {
        if (!me.loggedIn || me.role !== "admin") {
          router.push("/");
          return;
        }
        setCurrentUser({ userId: me.userId, role: me.role, username: me.username });
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

  const joined = useMemo(() => {
    const self = users.find((u) => u.id === currentUser?.userId);
    if (!self?.created_at) return null;
    const date = new Date(self.created_at);
    return Number.isNaN(date.getTime()) ? null : JOINED.format(date);
  }, [users, currentUser]);

  const createInvite = async () => {
    setCreating(true);
    try {
      const resp = await fetch(`${BACKEND}/invites`, { method: "POST" });
      const data = await resp.json();
      if (resp.ok) {
        setInvites((prev) => [
          {
            id: data.id || "",
            code: data.code,
            role: "member",
            expires_at: data.expires_at,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
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

  const toggleRole = async (id: string, currentRole: string) => {
    const newRole = currentRole === "admin" ? "member" : "admin";
    const msg =
      newRole === "admin"
        ? "Promote this member to admin? They'll be able to manage the household, run scans, and configure integrations."
        : "Demote this admin to member? They'll lose access to admin tools.";
    if (!window.confirm(msg)) return;
    const resp = await fetch(`${BACKEND}/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (resp.ok) setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role: newRole } : u)));
  };

  const copyInviteLink = (code: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/join/${code}`);
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

  /* ── Resend integration ──────────────────────────────────────────── */

  const validateResendKey = (key: string): string | null => {
    const trimmed = key.trim();
    if (!trimmed) return "API key cannot be empty.";
    if (!trimmed.startsWith("re_")) return 'Resend keys start with "re_" — this doesn\'t look right.';
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
        setResendSaveMsg({ type: "success", text: "Resend API key saved." });
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

  /* ── Email invite ────────────────────────────────────────────────── */

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
      const created: Invite = {
        id: "",
        code: data.code,
        role: "member",
        expires_at: data.expires_at,
        created_at: new Date().toISOString(),
      };
      if (resp.ok && data.email_sent) {
        setEmailSendResult({ type: "success", text: `Invite sent to ${data.email}` });
        setInvites((prev) => [created, ...prev]);
        setInviteEmail("");
        setInviteName("");
        setTimeout(() => setEmailInviteOpen(false), 2000);
      } else if (resp.ok) {
        setEmailSendResult({
          type: "error",
          text: `Invite created (${data.code}) but email failed: ${data.email_error || "Unknown error"}`,
        });
        setInvites((prev) => [created, ...prev]);
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
    return (
      <main className="kx-page narrow">
        <p className="kx-status" role="status">
          Loading your settings…
        </p>
      </main>
    );
  }

  return (
    <main className="kx-page narrow">
      <span className="kx-eyebrow">Settings</span>
      <h1 className="kx-title settings">Your household.</h1>

      {revealedKey && (
        <div className="kx-reveal">
          <strong>Your new API key</strong>
          <p className="kx-lede" style={{ margin: "6px 0 0" }}>
            Copy it now — it will not be shown again.
          </p>
          <code>{revealedKey}</code>
          <div className="kx-row-actions" style={{ marginLeft: 0 }}>
            <button className="kx-button" onClick={() => copyApiKey(revealedKey)}>
              {keyCopied ? "Copied" : "Copy"}
            </button>
            <button className="kx-button" onClick={() => setRevealedKey(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="kx-profilecard">
        {avatarUrl ? (
          <span className="kx-avatar xl">
            <img
              src={`${BACKEND}${avatarUrl}`}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </span>
        ) : (
          <span className="kx-avatar xl">{(displayName || "?").charAt(0).toUpperCase()}</span>
        )}
        <span className="kx-profilecard-name">
          <strong>{displayName}</strong>
          <span className="kx-mono">
            @{currentUser?.username}
            {currentUser?.role ? ` · ${currentUser.role}` : ""}
            {joined ? ` · joined ${joined}` : ""}
          </span>
        </span>
        <button className="kx-button" style={{ marginLeft: "auto" }} onClick={() => setAvatarEditorOpen(true)}>
          Edit profile
        </button>
      </div>

      {avatarEditorOpen && (
        <AvatarEditor
          currentAvatarUrl={avatarUrl}
          displayName={displayName}
          onSaved={(newUrl) => setAvatarUrl(newUrl)}
          onClose={() => setAvatarEditorOpen(false)}
        />
      )}

      <section className="kx-card">
        <div className="kx-cardhead">
          <h2>Household members</h2>
          <span className="kx-mono">{fmt.format(users.length)}</span>
          <div className="kx-cardhead-actions">
            <button
              className="kx-button"
              onClick={() => {
                if (!resendStatus.configured) {
                  document.getElementById("kx-integrations")?.scrollIntoView({ behavior: "smooth" });
                  setResendSaveMsg({ type: "error", text: "Add your Resend API key to send email invites." });
                  return;
                }
                setEmailInviteOpen(true);
                setEmailSendResult(null);
              }}
            >
              Invite someone
            </button>
          </div>
        </div>

        {emailInviteOpen && (
          <div className="kx-row" style={{ flexWrap: "wrap" }}>
            <input
              type="email"
              className="kx-input"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              autoComplete="off"
            />
            <input
              type="text"
              className="kx-input"
              placeholder="Name (optional)"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              autoComplete="off"
            />
            <div className="kx-row-actions">
              <button
                className="kx-button primary"
                onClick={sendEmailInvite}
                disabled={sendingEmail || !inviteEmail.trim()}
              >
                {sendingEmail ? "Sending…" : "Send invite"}
              </button>
              <button className="kx-button" onClick={() => setEmailInviteOpen(false)}>
                Cancel
              </button>
            </div>
            {emailSendResult && (
              <p className={`kx-note ${emailSendResult.type}`} style={{ margin: 0, width: "100%" }}>
                {emailSendResult.text}
              </p>
            )}
          </div>
        )}

        {users.map((member) => (
          <div key={member.id} className="kx-row">
            {member.avatar_url ? (
              <span className="kx-avatar">
                <img
                  src={`${BACKEND}${member.avatar_url}`}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </span>
            ) : (
              <span className="kx-avatar">{(member.display_name || member.username).charAt(0).toUpperCase()}</span>
            )}
            <span className="kx-row-info">
              <strong>{member.display_name || member.username}</strong>
              <span className="kx-mono">{member.role}</span>
            </span>
            {member.id === currentUser?.userId ? (
              <span className="kx-mono kx-row-actions">you</span>
            ) : (
              <span className="kx-row-actions">
                <button className="kx-button compact" onClick={() => toggleRole(member.id, member.role)}>
                  {member.role === "admin" ? "Demote" : "Make admin"}
                </button>
                <button className="kx-button danger" onClick={() => removeUser(member.id)}>
                  Remove
                </button>
              </span>
            )}
          </div>
        ))}
      </section>

      <section className="kx-card">
        <div className="kx-cardhead">
          <h2>API keys</h2>
          <div className="kx-cardhead-actions">
            <button className="kx-button" onClick={generateApiKey} disabled={generatingKey}>
              {generatingKey ? "Generating…" : "Generate key"}
            </button>
          </div>
        </div>
        {apiKeys.length === 0 ? (
          <div className="kx-row">
            <span className="kx-mono">No keys yet. Generate one to connect the mobile app.</span>
          </div>
        ) : (
          apiKeys.map((key) => (
            <div key={key.id} className="kx-row">
              <code className="kx-code">{key.key_prefix}…••••</code>
              <span className="kx-mono">
                {key.name} · {lastUsed(key.last_used_at)}
              </span>
              <span className="kx-row-actions">
                <button className="kx-button compact" onClick={() => rollApiKey(key.id)}>
                  Roll
                </button>
                <button className="kx-button danger" onClick={() => deleteApiKey(key.id)}>
                  Delete
                </button>
              </span>
            </div>
          ))
        )}
      </section>

      <section className="kx-card">
        <div className="kx-cardhead">
          <h2>Invite codes</h2>
          <div className="kx-cardhead-actions">
            <button className="kx-button" onClick={createInvite} disabled={creating}>
              {creating ? "Creating…" : "New code"}
            </button>
          </div>
        </div>
        {invites.length === 0 ? (
          <div className="kx-row">
            <span className="kx-mono">No live invites.</span>
          </div>
        ) : (
          invites.map((invite) => (
            <div key={invite.id || invite.code} className="kx-row">
              <code className="kx-code">{invite.code}</code>
              <span className="kx-mono">
                {invite.role} · {expiresIn(invite.expires_at)}
              </span>
              <span className="kx-row-actions">
                <button className="kx-button compact" onClick={() => copyInviteLink(invite.code)}>
                  {copied === invite.code ? "Copied" : "Copy link"}
                </button>
                <button className="kx-button danger" onClick={() => revokeInvite(invite.id)}>
                  Revoke
                </button>
              </span>
            </div>
          ))
        )}
      </section>

      <section className="kx-card" id="kx-integrations">
        <div className="kx-cardhead">
          <h2>Integrations</h2>
        </div>

        <div className="kx-row">
          <span className="kx-row-info">
            <strong>Flickr</strong>
            <span className="kx-mono">
              {counts?.on_flickr
                ? `connected · ${fmt.format(counts.on_flickr)} photos mirrored`
                : "mirrors your originals"}
            </span>
          </span>
          <span className="kx-row-actions">
            {counts?.on_flickr ? <span className="kx-statuspill">Active</span> : null}
          </span>
        </div>

        <div className="kx-row">
          <span className="kx-row-info">
            <strong>Resend</strong>
            <span className="kx-mono">
              {resendStatus.configured
                ? `configured · ${resendStatus.key_preview ?? "key saved"}`
                : "sends invite emails"}
            </span>
          </span>
          <span className="kx-row-actions">
            <input
              type="password"
              className="kx-input wide"
              placeholder={
                resendStatus.configured ? "Paste a new key to replace it" : "Paste your Resend API key (re_…)"
              }
              value={resendKeyInput}
              onChange={(e) => setResendKeyInput(e.target.value)}
              autoComplete="off"
              aria-label="Resend API key"
            />
            <button className="kx-button" onClick={saveResendKey} disabled={savingResend || !resendKeyInput.trim()}>
              {savingResend ? "Saving…" : "Save"}
            </button>
            {resendStatus.configured && (
              <button className="kx-button danger" onClick={removeResendKey}>
                Remove
              </button>
            )}
          </span>
        </div>
        {resendSaveMsg && <p className={`kx-note ${resendSaveMsg.type}`}>{resendSaveMsg.text}</p>}

        <div className="kx-row">
          <span className="kx-row-info">
            <strong>Notifications</strong>
            <span className="kx-mono">new people, finished scans, shares</span>
          </span>
          <span className="kx-row-actions">
            <Link href="/settings/notifications" className="kx-button">
              Manage
            </Link>
          </span>
        </div>
      </section>
    </main>
  );
}
