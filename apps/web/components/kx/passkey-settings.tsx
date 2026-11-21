"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addPasskey, passkeyError, passkeyRequest, usePasskeySupport } from "@/lib/passkeys";

interface Passkey {
  credential_id: string;
  created_at: string;
}

export function PasskeySettings({ userId }: { userId: string }) {
  const supported = usePasskeySupport();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data, refetch } = useQuery({
    queryKey: ["account-passkeys", userId],
    queryFn: () => passkeyRequest<{ passkeys: Passkey[] }>("list"),
    retry: false,
  });
  async function update(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refetch();
    } catch (error) {
      setError(passkeyError(error));
    } finally {
      setBusy(false);
    }
  }
  return <>
    <div className="kx-connection">
      <div>
        <h3>Passkeys</h3>
        <p>{supported ? "Sign in with your device, security key, or password manager." : "Use a supported browser to add a passkey."}</p>
      </div>
      {supported && <button className="kx-button" disabled={busy} onClick={() => void update(addPasskey)}>Add passkey</button>}
    </div>
    {data?.passkeys.map(key => (
      <div key={key.credential_id} className="kx-connection">
        <div><h3>Passkey</h3><p>Added {new Date(key.created_at).toLocaleDateString()}</p></div>
        <button className="kx-button" disabled={busy} onClick={() => void update(() => passkeyRequest("remove", { credential_id: key.credential_id }))}>Remove</button>
      </div>
    ))}
    {error && <p className="kx-connection-notice" role="alert">{error}</p>}
  </>;
}
