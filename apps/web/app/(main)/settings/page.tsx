"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";
import { BACKEND } from "@/lib/constants";

interface HouseholdUser {
  id: string;
  username: string;
  display_name: string;
  role: string;
  flickr_user_id: string | null;
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

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch(`${BACKEND}/users`).then((r) => r.json()),
      fetch(`${BACKEND}/invites`).then((r) => r.json()),
      fetch(`${BACKEND}/api-keys`).then((r) => r.json()),
    ])
      .then(([me, usersData, invitesData, keysData]) => {
        if (!me.loggedIn || me.role !== "admin") {
          router.push("/");
          return;
        }
        setCurrentUser({ userId: me.userId, role: me.role });
        setUsers(usersData.users || []);
        setInvites(invitesData.invites || []);
        setApiKeys(keysData.keys || []);
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
    const link = `${window.location.origin}/join?code=${code}`;
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

      <div className="settings-section">
        <div className="settings-header">
          <h2>Household Members</h2>
          <span className="settings-count">{users.length}</span>
        </div>
        <div className="settings-list">
          {users.map((u) => (
            <div key={u.id} className="settings-row">
              <div className="settings-avatar">
                {(u.display_name || u.username).charAt(0).toUpperCase()}
              </div>
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
                    Created {k.created_at ? new Date(k.created_at).toLocaleDateString() : "—"}
                    {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`}
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

      <div className="settings-section">
        <div className="settings-header">
          <h2>Invite Codes</h2>
          <button className="button primary" onClick={createInvite} disabled={creating} style={{ fontSize: 13, minHeight: 36 }}>
            {creating ? "Creating..." : "Create invite"}
          </button>
        </div>
        {invites.length === 0 ? (
          <p className="settings-empty">No active invites. Create one to invite family members.</p>
        ) : (
          <div className="settings-list">
            {invites.map((inv) => (
              <div key={inv.id} className="settings-row">
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
