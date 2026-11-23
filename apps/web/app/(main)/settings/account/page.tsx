"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";
import { useUser } from "@/lib/use-user";

interface Management {
  is_owner: boolean;
  has_password: boolean;
  recently_signed_in: boolean;
  other_members: number;
}

const labels = {
  delete: "Delete Account",
  "delete-household": "Delete Household",
  "transfer-ownership": "Transfer Ownership",
} as const;

type Operation = keyof typeof labels;

async function load<T>(path: string): Promise<T> {
  const response = await fetch(`${BACKEND}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load account settings.");
  return response.json();
}

export default function ManageAccountPage() {
  const { user } = useUser();
  const state = useQuery({
    queryKey: ["account-management"],
    queryFn: () => load<Management>("/auth/account/management"),
  });
  const members = useQuery({
    queryKey: ["transfer-ownership-members"],
    queryFn: () => load<{ users: { id: string; display_name: string }[] }>("/users"),
    enabled: Boolean(state.data?.is_owner && state.data.other_members > 0),
  });
  const [operation, setOperation] = useState<Operation>();
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [member, setMember] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deleted, setDeleted] = useState(false);
  const required = operation === "delete-household" ? "DELETE HOUSEHOLD" : operation === "delete" ? "DELETE" : null;
  const canConfirm = state.data?.has_password ? password.length > 0 : state.data?.recently_signed_in;

  function choose(next: Operation) {
    setOperation(next);
    setError("");
    setMessage("");
    setConfirmation("");
    setPassword("");
    setMember("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!operation) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${BACKEND}/auth/account/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kindred-Account-Action": "1" },
        body: JSON.stringify({
          confirmation: required === null ? undefined : confirmation,
          member_id: operation === "transfer-ownership" ? member : undefined,
          password: state.data?.has_password ? password : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Could not complete the change.");
        return;
      }
      setOperation(undefined);
      if (operation === "transfer-ownership") {
        setMessage("Ownership transferred.");
        await state.refetch();
        return;
      }
      setDeleted(true);
      setMessage((operation === "delete-household" ? "Household deleted." : "Account deleted.") +
        (data.manual_apple_revocation ? " To disconnect Apple sign-in, remove Kindred in your Apple Account’s Sign in with Apple settings." : ""));
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      setError("Could not reach your Kindred server. Check your connection and try again.");
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return <>
    <h2 className="kx-setting-title">Manage account</h2>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {deleted ? <a href="/login">Back to sign-in</a> : <>
      {state.isPending && <p role="status">Loading account settings…</p>}
      {state.isError && <p role="alert">Account management is unavailable on this server.</p>}
      {state.data && !operation && <div>
        {state.data.is_owner ? <>
          <p>Transfer ownership to another member to keep the household open when you delete your account.</p>
          {state.data.other_members > 0 &&
            <button className="kx-setting-row" onClick={() => choose("transfer-ownership")}>{labels["transfer-ownership"]}</button>}
          <button className="kx-setting-row" onClick={() => choose("delete-household")}>{labels["delete-household"]}</button>
        </> : <button className="kx-setting-row" onClick={() => choose("delete")}>{labels.delete}</button>}
      </div>}
      {operation && <form onSubmit={submit}>
        <h3>{labels[operation]}</h3>
        {operation === "transfer-ownership" ? <label>New owner
          <select value={member} onChange={event => setMember(event.target.value)} required>
            <option value="">Choose a member</option>
            {user?.userId && members.data?.users.filter(member => member.id !== user.userId).map(member =>
              <option key={member.id} value={member.id}>{member.display_name}</option>)}
          </select>
        </label> : <>
          <p>{operation === "delete-household"
            ? "This deletes everyone’s Kindred accounts and the household catalog, albums, and connections. NAS originals, R2 thumbnails, and Flickr copies remain in storage. A new installation requires a new database."
            : "This deletes your profile, favorites, sign-in methods, and share links. Media in the household library remains available to the household."}</p>
          <label>Type {required} to confirm
            <input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" required />
          </label>
        </>}
        {state.data?.has_password
          ? <label>Current password<input type="password" autoComplete="current-password"
              value={password} onChange={event => setPassword(event.target.value)} required /></label>
          : !state.data?.recently_signed_in &&
              <p><a href="/login?return=%2Fsettings%2Faccount">Sign in again</a> to confirm the change.</p>}
        <button type="button" className="kx-button" onClick={() => setOperation(undefined)} disabled={busy}>Cancel</button>
        <button type="submit" className="kx-button" disabled={busy || !canConfirm ||
          (required !== null && confirmation !== required) || (operation === "transfer-ownership" && !member)}>
          {busy ? "Saving…" : labels[operation]}
        </button>
      </form>}
    </>}
  </>;
}
