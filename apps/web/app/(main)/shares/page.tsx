"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";

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

export default function SharesPage() {
  const queryClient = useQueryClient();
  const [albumId, setAlbumId] = useState("");
  const [password, setPassword] = useState("");
  const [allowDownload, setAllowDownload] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: albums } = useQuery<Album[]>({
    queryKey: ["albums"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/albums`);
      if (!response.ok) return [];
      return (await response.json()).albums ?? [];
    },
  });

  const { data: shares, isPending } = useQuery<Share[]>({
    queryKey: ["shares"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/shares`);
      if (!response.ok) throw new Error("Your shares could not be loaded.");
      return (await response.json()).shares ?? [];
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
      if (!response.ok) throw new Error(data.detail || "Could not create the link");
      return data as Share & { url: string };
    },
    onSuccess: (data) => {
      // The token is shown exactly once — it is only stored hashed.
      setFreshLink(data.url);
      setError(null);
      setPassword("");
      void queryClient.invalidateQueries({ queryKey: ["shares"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`${BACKEND}/shares/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not revoke that link");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["shares"] }),
  });

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head">
          <div>
            <h2>Shared links</h2>
            <p>
              Anyone with a link can see what it points at — and nothing else. Revoke
              one and it stops working immediately.
            </p>
          </div>
        </div>

        <section className="share-create">
          <h3>Share an album</h3>
          <div className="share-create-row">
            <label className="facet-field">
              <span>Album</span>
              <select value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
                <option value="">Choose an album…</option>
                {(albums ?? []).map((album) => (
                  <option key={album.id ?? album.name} value={album.id ?? ""}>
                    {album.name} ({album.photo_count})
                  </option>
                ))}
              </select>
            </label>

            <label className="facet-field">
              <span>Expires</span>
              <select value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)}>
                {EXPIRY_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </select>
            </label>

            <label className="facet-field">
              <span>Password (optional)</span>
              <input type="text" value={password} placeholder="No password"
                onChange={(e) => setPassword(e.target.value)} />
            </label>

            <label className="share-checkbox">
              <input type="checkbox" checked={allowDownload}
                onChange={(e) => setAllowDownload(e.target.checked)} />
              Allow downloading originals
            </label>

            <button className="button primary" disabled={!albumId || create.isPending}
              onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create link"}
            </button>
          </div>

          {error && <p className="share-error" role="alert">{error}</p>}

          {freshLink && (
            <div className="share-fresh" role="status">
              <p><strong>Copy this now.</strong> The link is only shown once — Kindred
                stores it hashed, so it cannot be shown again.</p>
              <div className="share-fresh-row">
                <input readOnly value={freshLink} onFocus={(e) => e.currentTarget.select()} />
                <button className="button small" onClick={() => void copyLink(freshLink)}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </section>

        {isPending && <p role="status">Loading shared links…</p>}

        {!isPending && (shares ?? []).length === 0 && (
          <p>Nothing is shared right now.</p>
        )}

        {(shares ?? []).length > 0 && (
          <table className="share-table">
            <thead>
              <tr>
                <th>What</th><th>Settings</th><th>Views</th><th>Expires</th><th />
              </tr>
            </thead>
            <tbody>
              {(shares ?? []).map((share) => (
                <tr key={share.id}>
                  <td>{share.title || share.album_name || share.subject_type}</td>
                  <td>
                    {share.password_protected ? "Password" : "Open link"}
                    {share.allow_download && " · downloads on"}
                  </td>
                  <td>{share.view_count}</td>
                  <td>
                    {share.expires_at
                      ? new Date(share.expires_at).toLocaleDateString()
                      : "Never"}
                  </td>
                  <td>
                    <button className="button small ghost"
                      onClick={() => revoke.mutate(share.id)}
                      disabled={revoke.isPending}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
