"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import { KxEmpty, KxErrorBanner, KxSkeletonRows } from "@/components/kx/states";

interface Album {
  id: string | null;
  name: string;
  photo_count: number;
}

interface Share {
  id: string;
  subject_type: "photo" | "album";
  album_id: string | null;
  album_name: string | null;
  title: string;
  password_protected: boolean;
  allow_download: boolean;
  expires_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string | null;
}

const EXPIRY_CHOICES = [
  { value: "", label: "Never expires" },
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "365", label: "1 year" },
];

/** Live, public and expired are three different amounts of exposure. */
function statusOf(share: Share): { pill: string; label: string } {
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
    return { pill: "expired", label: "Expired" };
  }
  if (!share.password_protected) return { pill: "public", label: "Public" };
  return { pill: "live", label: "Live" };
}

/** "expires in 6 days", "no expiry", "expired". */
function expiryLine(share: Share): string {
  if (!share.expires_at) return "no expiry";
  const days = Math.ceil((new Date(share.expires_at).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "expired";
  if (days === 0) return "expires today";
  return `expires in ${fmt.format(days)} ${days === 1 ? "day" : "days"}`;
}

export default function SharesPage() {
  const queryClient = useQueryClient();
  const [making, setMaking] = useState(false);
  const [albumId, setAlbumId] = useState("");
  const [password, setPassword] = useState("");
  const [allowDownload, setAllowDownload] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const { data: albums } = useQuery<Album[]>({
    queryKey: ["kx-albums"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/albums`);
      if (!response.ok) return [];
      const data: { albums?: Album[] } = await response.json();
      return data.albums ?? [];
    },
    enabled: making,
  });

  const { data: shares, error, isPending, refetch } = useQuery<Share[]>({
    queryKey: ["kx-shares"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/shares`);
      if (!response.ok) throw new Error("Your links could not be loaded.");
      const data: { shares?: Share[] } = await response.json();
      return data.shares ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${BACKEND}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_type: "album",
          album_id: albumId,
          password: password || null,
          allow_download: allowDownload,
          expires_in_days: expiresInDays ? Number(expiresInDays) : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "That link could not be made.");
      return data as Share & { url: string };
    },
    onSuccess: (data) => {
      // The token is shown once — the server only keeps a hash of it.
      setFreshLink(data.url);
      setProblem(null);
      setPassword("");
      setMaking(false);
      void queryClient.invalidateQueries({ queryKey: ["kx-shares"] });
      void queryClient.invalidateQueries({ queryKey: ["share-count"] });
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`${BACKEND}/shares/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("That link could not be revoked.");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["kx-shares"] });
      void queryClient.invalidateQueries({ queryKey: ["share-count"] });
    },
  });

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const rows = shares ?? [];

  return (
    <main className="kx-page" style={{ maxWidth: 1000 }}>
      <span className="kx-eyebrow">Shared</span>
      <h1 className="kx-title">What has left the house.</h1>
      <p className="kx-lede">
        Every link you have handed out, what it points at, and how to take it back.
      </p>

      {problem && <KxErrorBanner title="That did not work" detail={problem} />}

      {freshLink && (
        <div className="kx-banner" role="status" style={{ marginBottom: 16 }}>
          <span className="kx-banner-copy">
            <strong>Copy this now.</strong>
            <span className="kx-mono">
              The link is only shown once — Kindred stores it hashed, so it cannot be shown again.
            </span>
          </span>
          <button
            className="kx-button primary"
            onClick={() => {
              void navigator.clipboard.writeText(freshLink).then(() => setCopied("fresh"));
            }}
          >
            {copied === "fresh" ? "Copied" : "Copy link"}
          </button>
        </div>
      )}

      <section className="kx-card">
        <div className="kx-cardhead">
          <h2>Active links</h2>
          <span className="kx-mono">{fmt.format(rows.length)}</span>
          <div className="kx-cardhead-actions">
            <button className="kx-button primary" onClick={() => setMaking((open) => !open)}>
              New share
            </button>
          </div>
        </div>

        {making && (
          <div className="kx-row" style={{ flexWrap: "wrap", gap: 12 }}>
            <label className="kx-mono">
              Album{" "}
              <select
                className="kx-select"
                value={albumId}
                onChange={(event) => setAlbumId(event.target.value)}
              >
                <option value="">Choose an album…</option>
                {(albums ?? [])
                  .filter((album) => album.id)
                  .map((album) => (
                    <option key={album.id} value={album.id as string}>
                      {album.name} ({fmt.format(album.photo_count)})
                    </option>
                  ))}
              </select>
            </label>
            <label className="kx-mono">
              Expires{" "}
              <select
                className="kx-select"
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
              >
                {EXPIRY_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="kx-mono">
              Password{" "}
              <input
                className="kx-input"
                type="text"
                value={password}
                placeholder="No password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="kx-mono">
              <input
                type="checkbox"
                checked={allowDownload}
                onChange={(event) => setAllowDownload(event.target.checked)}
              />{" "}
              Allow downloading originals
            </label>
            <div className="kx-row-actions">
              <button
                className="kx-button primary"
                disabled={!albumId || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Making…" : "Make the link"}
              </button>
              <button className="kx-button" onClick={() => setMaking(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}
        {!error && isPending && (
          <div style={{ padding: 16 }}>
            <KxSkeletonRows count={3} height={46} />
          </div>
        )}
        {!error && !isPending && rows.length === 0 && (
          <div style={{ padding: 16 }}>
            <KxEmpty
              title="Nothing has left the house."
              body="Share an album and the link will appear here, with a way to take it back."
            />
          </div>
        )}

        {rows.map((share) => {
          const status = statusOf(share);
          return (
            <div className="kx-sharerow" key={share.id}>
              {/* TODO: the design leads each row with a 46px thumb of what the
                  link points at. /shares returns no cover — the row carries an
                  album id and a title but no photo — so the row leads with the
                  title instead. A `cover_photo_id` on the share row would add
                  it. */}
              <span className="kx-sharerow-body">
                <strong>{share.title || share.album_name || "Untitled share"}</strong>
                <span className="kx-cardmeta">
                  {share.password_protected ? "password needed" : "anyone with the link"}
                  {share.allow_download ? " · can download" : " · view only"}
                </span>
              </span>
              <span className="kx-sharerow-tail">
                <span className="kx-cardmeta">
                  {fmt.format(share.view_count)} {share.view_count === 1 ? "view" : "views"} ·{" "}
                  {expiryLine(share)}
                </span>
                <span className={`kx-statuspill ${status.pill}`}>{status.label}</span>
                {/* TODO: /shares does not return the link, only its id — the
                    token is hashed and shown once at creation. Copying an
                    existing link is impossible without a rotate endpoint that
                    issues a fresh token. */}
                <button
                  className="kx-button compact"
                  disabled
                  title="The link is only shown once, when it is made"
                >
                  Copy link
                </button>
                <button
                  className="kx-button compact danger"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(share.id)}
                >
                  Revoke
                </button>
              </span>
            </div>
          );
        })}
      </section>
    </main>
  );
}
