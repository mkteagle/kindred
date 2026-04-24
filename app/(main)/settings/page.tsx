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

export default function SettingsPage() {
  const router = useRouter();
  const [users, setUsers] = useState<HouseholdUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<{ userId: string; role: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch(`${BACKEND}/users`).then((r) => r.json()),
      fetch(`${BACKEND}/invites`).then((r) => r.json()),
    ])
      .then(([me, usersData, invitesData]) => {
        if (!me.loggedIn || me.role !== "admin") {
          router.push("/");
          return;
        }
        setCurrentUser({ userId: me.userId, role: me.role });
        setUsers(usersData.users || []);
        setInvites(invitesData.invites || []);
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

  if (loading) {
    return <div className="settings-page"><Spinner /></div>;
  }

  return (
    <div className="settings-page">
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
