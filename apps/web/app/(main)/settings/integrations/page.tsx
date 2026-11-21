"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/lib/use-user";
import { BACKEND, fmt } from "@/lib/constants";
import { StorageCard } from "@/components/kx/storage-card";
import { useLibraryCounts, useStorageStatus } from "@/components/kx/use-library";
import { KxErrorBanner } from "@/components/kx/states";
import { useEffect, useState } from "react";
import { PasskeySettings } from "@/components/kx/passkey-settings";

async function read<T>(url: string): Promise<T> {
  const result = await fetch(url);
  if (!result.ok) throw new Error("Connections could not be loaded. Try again.");
  return result.json();
}

export default function IntegrationsPage() {
  const { user, isLoading, isAdmin } = useUser();
  const { data: storage, refetch: refreshStorage, isFetching: checking } = useStorageStatus();
  const { data: counts } = useLibraryCounts();
  const [notice, setNotice] = useState("");
  const providers = useQuery({ queryKey: ["auth-providers"], queryFn: () => read<{ google: boolean; apple: boolean }>("/api/auth/providers") });
  const identities = useQuery({ queryKey: ["auth-identities"], queryFn: () => read<{ identities: { provider: string; email?: string }[] }>(`${BACKEND}/auth/identities`), enabled: !!user });
  const flickr = useQuery({ queryKey: ["flickr-integration"], queryFn: () => read<{ configured: boolean; connected: boolean; user_id?: string }>(`${BACKEND}/integrations/flickr`), enabled: isAdmin });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("error")) setNotice("The connection could not be completed. Sign in again and retry; an identity already linked to another account cannot be reused.");
    if (params.get("connected") === "flickr") setNotice("Flickr is connected. Your Kindred sign-in stays the same.");
  }, []);
  if (isLoading) return <main className="kx-page"><p role="status">Loading connections…</p></main>;
  return <main className="kx-page kx-integrations-page">
    <div className="kx-pagehead"><div><h1 className="kx-title">Make yourself at home.</h1><p className="kx-lede">Your account. Your storage. Everything connected in one place.</p></div></div>
    {notice && <p className="kx-connection-notice" role="status">{notice}</p>}
    <section className="kx-connection-section"><div className="kx-section-copy"><span className="kx-eyebrow">SIGN IN</span><h2>A familiar way in.</h2><p>Connect a provider to your existing Kindred account. Only invited members can join an established library.</p></div>
      <div className="kx-connection-list">
        {user && <PasskeySettings userId={user.userId} />}
        {identities.error && <KxErrorBanner detail={identities.error.message} onRetry={() => void identities.refetch()} />}
        {(["google", "apple"] as const).map(provider => {
          const identity = identities.data?.identities.find(item => item.provider === provider);
          const enabled = providers.data?.[provider];
          return <div className="kx-connection" key={provider}>
            <span className={`kx-provider-icon ${provider}`}>{provider === "google" ? "G" : <svg viewBox="0 0 24 24" width="25" height="25" fill="currentColor" aria-hidden="true"><path d="M16.3 1.2c.2 1.4-.4 2.8-1.2 3.7-.9 1-2.2 1.6-3.5 1.5-.2-1.3.4-2.7 1.2-3.6.9-1 2.3-1.6 3.5-1.6zM20 17.4c-.5 1.1-.8 1.7-1.5 2.7-.9 1.3-2.2 3-3.8 3-1.4 0-1.8-.9-3.7-.9s-2.3.9-3.7.9c-1.6 0-2.8-1.5-3.7-2.8C1 16.6.5 11.5 2.2 8.9c1.2-1.9 3.1-3 4.9-3 1.5 0 2.5.9 3.8.9 1.2 0 2.1-.9 3.8-.9 1.5 0 3.1.8 4.3 2.1-3.8 2.1-3.2 7.5 1 9.4z"/></svg>}</span>
            <div><h3>{provider === "google" ? "Google" : "Apple"}</h3><p>{identity ? identity.email || "Account connected" : enabled ? "Use this account to sign in to Kindred" : "Configure this provider on your server to enable sign-in"}</p></div>
            {identity ? <span className="kx-connected-badge">Connected</span> : <a aria-disabled={!enabled || identities.isPending || !!identities.error} className="kx-button" href={enabled && !identities.isPending && !identities.error ? `/api/auth/${provider}?link=1` : undefined}>Connect</a>}
          </div>;
        })}
      </div>
    </section>
    <section className="kx-connection-section"><div className="kx-section-copy"><span className="kx-eyebrow">STORAGE & COPIES</span><h2>A home for every original.</h2><p>Keep originals on your own NAS. Add Flickr for a separate copy. Each connection belongs to this installation.</p></div>
      <div className="kx-connection-list"><StorageCard full />
        {isAdmin && <Link href="/storage" className="kx-button" style={{ marginBottom: 18 }}>Browse NAS folders →</Link>}
        <div className="kx-connection"><span className="kx-provider-icon nas">NAS</span><div><h3>{storage?.name || "Your NAS"}</h3><p>{storage?.available ? "The server can reach your storage folder." : storage?.configured ? "The configured folder is unavailable. Check the server mount." : "Mount your NAS folder on the Kindred server and set PHOTO_STORAGE_ROOT."}</p></div>
          {isAdmin && <button className="kx-button" disabled={checking} onClick={async () => { const result = await refreshStorage(); setNotice(result.data?.available ? "The server can reach the storage folder and read its capacity." : "Storage is unavailable. Check the folder mounted on your Kindred server."); }}>{checking ? "Checking…" : "Check connection"}</button>}
        </div>
        {isAdmin && <><div className="kx-connection"><span className="kx-provider-icon flickr"><i/><i/></span><div><h3>Flickr</h3><p>{flickr.data?.connected ? `Connected${flickr.data.user_id ? ` · ${flickr.data.user_id}` : ""}${counts ? ` · ${fmt.format(counts.on_flickr)} catalog items have a copy` : ""}` : "A separate copy of supported photos and videos."}</p></div>
          <a className="kx-button" aria-disabled={!flickr.data?.configured} href={flickr.data?.configured ? "/api/auth/flickr?integration=1" : undefined}>{flickr.data?.connected ? "Reconnect" : "Connect Flickr"}</a></div>
          {flickr.error && <KxErrorBanner detail={flickr.error.message} onRetry={() => void flickr.refetch()} />}
          {flickr.data && !flickr.data.configured && <p className="kx-connection-help">Add your own FLICKR_API_KEY and FLICKR_SECRET to the web app and server, then restart. Register /api/auth/callback on your web address as the Flickr callback.</p>}
        </>}
      </div>
    </section>
    <p className="kx-connection-help">Storage and integration configuration is managed by the library owner. A folder availability check does not verify write permission or an off-site backup. <a href="/docs">Setup guide →</a></p>
  </main>;
}
