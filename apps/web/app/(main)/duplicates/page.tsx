"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "@/components/ui";
import type { DuplicatesResponse } from "@/types";
import { BACKEND, fmt } from "@/lib/constants";
import { useLightbox } from "@/components/photo-lightbox";
import type { LightboxPhoto } from "@/components/photo-lightbox";

export default function DuplicatesPage() {
  const { openLightbox } = useLightbox();
  const [threshold, setThreshold] = useState(0.05);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deleted: number; failed: number } | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<DuplicatesResponse>({
    queryKey: ["duplicates", threshold],
    staleTime: 5 * 60 * 1000, queryFn: () =>
      fetch(`${BACKEND}/duplicates?threshold=${threshold}`).then((r) => r.json()),
  });

  const groups = data?.groups || [];

  const toggleSelect = (photoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const selectAllDupes = () => {
    // For each group, select all photos except the first (keep the original)
    const toSelect = new Set<string>();
    groups.forEach((group) => {
      group.photos.slice(1).forEach((p) => toSelect.add(p.photo_id));
    });
    setSelected(toSelect);
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    const confirmed = window.confirm(
      `Delete ${selected.size} photo${selected.size !== 1 ? "s" : ""} from Flickr permanently? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setDeleteResult(null);
    try {
      const resp = await fetch(`${BACKEND}/flickr/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: [...selected] }),
      });
      const result = await resp.json();
      setDeleteResult({ deleted: result.count || 0, failed: result.failed?.length || 0 });
      setSelected(new Set());
      // Refresh duplicates list
      qc.invalidateQueries({ queryKey: ["duplicates"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    } catch (e) {
      setDeleteResult({ deleted: 0, failed: selected.size });
    }
    setDeleting(false);
  };

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head" style={{ marginBottom: 24 }}>
          <div>
            <h2>Duplicates</h2>
            <p>
              Groups of near-duplicate photos detected by visual similarity.
              Select duplicates to delete from Flickr.
            </p>
          </div>
          {groups.length > 0 && (
            <div className="summary-note">
              {fmt.format(groups.length)} group{groups.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        <div className="duplicates-controls">
          <label className="duplicates-slider-label">
            <span>Sensitivity</span>
            <input
              type="range"
              min={0.01}
              max={0.15}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="duplicates-slider"
            />
            <span className="duplicates-slider-value">{threshold.toFixed(2)}</span>
          </label>
          <span className="duplicates-slider-hint">
            Lower = stricter (near-exact), higher = looser (more matches)
          </span>
        </div>

        {/* Batch actions */}
        {groups.length > 0 && (
          <div className="dup-actions">
            <Button small variant="ghost" onClick={selectAllDupes}>
              Select all duplicates (keep originals)
            </Button>
            {selected.size > 0 && (
              <>
                <Button small variant="danger" onClick={deleteSelected} disabled={deleting}>
                  {deleting ? "Deleting..." : `Delete ${selected.size} from Flickr`}
                </Button>
                <Button small variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear selection
                </Button>
              </>
            )}
            {deleteResult && (
              <span className="dup-result">
                {deleteResult.deleted > 0 && `${deleteResult.deleted} deleted`}
                {deleteResult.failed > 0 && ` · ${deleteResult.failed} failed`}
              </span>
            )}
          </div>
        )}

        {isLoading && (
          <div className="empty-state"><Spinner /></div>
        )}

        {!isLoading && groups.length === 0 && (
          <div className="empty-state">
            <div>
              <h2>No duplicates found</h2>
              <p>
                No near-duplicate groups at threshold {threshold.toFixed(2)}.
                Try increasing the threshold for looser matching.
              </p>
            </div>
          </div>
        )}

        {!isLoading && groups.map((group, idx) => (
          <div key={idx} className="duplicate-group">
            <div className="duplicate-group-header">
              <span className="duplicate-group-similarity">
                {Math.round(group.similarity * 100)}% similar
              </span>
              <span className="duplicate-group-count">
                {group.photos.length} photo{group.photos.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="duplicate-group-row">
              {group.photos.map((photo, photoIdx) => (
                <div
                  key={photo.photo_id}
                  className={`duplicate-photo ${selected.has(photo.photo_id) ? "dup-selected" : ""}`}
                >
                  <img
                    src={photo.thumb_url || photo.photo_url}
                    alt="Duplicate photo"
                    onClick={() => {
                      const lbPhotos: LightboxPhoto[] = group.photos.map((p) => ({
                        photo_id: p.photo_id,
                        thumb_url: p.thumb_url || p.photo_url,
                        flickr_url: p.flickr_url,
                        photo_url: p.photo_url,
                      }));
                      openLightbox(photo.photo_id, lbPhotos);
                    }}
                  />
                  {photoIdx === 0 && (
                    <span className="dup-original-badge">Original</span>
                  )}
                  <button
                    className={`dup-check ${selected.has(photo.photo_id) ? "checked" : ""}`}
                    onClick={() => toggleSelect(photo.photo_id)}
                    title={selected.has(photo.photo_id) ? "Deselect" : "Select for deletion"}
                  >
                    {selected.has(photo.photo_id) ? "✓" : ""}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        <footer className="kindling-footer">
          <span>By Kindling Signal</span>
          <p>
            Kindling builds useful software with character: warm enough for
            real homes, sharp enough to hold up in real use.
          </p>
        </footer>
      </main>
    </div>
  );
}
