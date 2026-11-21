"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KxErrorBanner } from "@/components/kx/states";
import { BACKEND } from "@/lib/constants";
import { refreshLibraryVisibility } from "@/lib/library-junk";
import { useUser } from "@/lib/use-user";

interface Preferences {
  hide_junk: boolean;
  auto_mark: boolean;
}

const key = ["library-junk-settings"];

export default function LibrarySettingsPage() {
  const { isAdmin } = useUser();
  const queryClient = useQueryClient();
  const preferences = useQuery<Preferences>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${BACKEND}/library/junk-settings`, { signal });
      if (!response.ok) throw new Error("Library settings are unavailable.");
      return response.json();
    },
  });
  const save = useMutation({
    mutationFn: async (change: Partial<Preferences>): Promise<Preferences> => {
      const response = await fetch(`${BACKEND}/library/junk-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!response.ok) throw new Error("The setting couldn’t be saved. Try again.");
      return response.json();
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(key, updated);
      refreshLibraryVisibility(queryClient);
    },
  });

  return <>
    <h2 className="kx-setting-title">Library</h2>
    {preferences.isPending && <p role="status">Loading library settings…</p>}
    {preferences.error && <KxErrorBanner detail={preferences.error.message} onRetry={() => void preferences.refetch()} />}
    {preferences.data && <>
      <label className="kx-setting-toggle">
        <span><strong>Hide junk by default</strong><small>Keep marked items out of your Library and Search. This only changes your view.</small></span>
        <input type="checkbox" role="switch" checked={preferences.data.hide_junk} disabled={save.isPending}
          onChange={event => save.mutate({ hide_junk: event.target.checked })} />
      </label>
      {isAdmin && <label className="kx-setting-toggle">
        <span><strong>Automatically mark junk</strong><small>Kindred flags likely screenshots, receipts, documents, standalone codes, and blank images in the shared library.</small></span>
        <input type="checkbox" role="switch" checked={preferences.data.auto_mark} disabled={save.isPending}
          onChange={event => save.mutate({ auto_mark: event.target.checked })} />
      </label>}
    </>}
    {save.error && <p className="kx-note error" role="alert">{save.error.message}</p>}
    <Link href="/gallery/junk" className="kx-setting-row">Review junk <span aria-hidden="true">›</span></Link>
    <p className="kx-setting-description">Marked photos stay in your backups and are available to review anytime.</p>
  </>;
}
