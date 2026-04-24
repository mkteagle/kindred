"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Spinner } from "@/components/ui";
import { BACKEND, fmt } from "@/lib/constants";

interface ObjectPhoto {
  photo_id: string;
  distance: number;
  photo_url: string;
  thumb_url: string;
  flickr_url: string;
  photo_title: string;
}

interface ObjectsResponse {
  objects: Record<string, ObjectPhoto[]>;
}

function ObjectCard({ label, photos }: { label: string; photos: ObjectPhoto[] }) {
  const [expanded, setExpanded] = useState(false);
  const preview = photos.slice(0, 6);
  const remaining = photos.length - preview.length;
  const visible = expanded ? photos : preview;

  return (
    <article className="scene-card">
      <div className="scene-card-header">
        <div>
          <h3 className="scene-card-label">{label}</h3>
          <span className="scene-card-count">
            {fmt.format(photos.length)} photo{photos.length !== 1 ? "s" : ""}
          </span>
        </div>
        {remaining > 0 && (
          <Button small variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show less" : `Show all ${fmt.format(photos.length)}`}
          </Button>
        )}
      </div>
      <div className="scene-photo-grid">
        {visible.map((photo) => (
          <a
            key={photo.photo_id}
            href={photo.flickr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="clip-result-card"
          >
            <img src={photo.thumb_url || photo.photo_url} alt={photo.photo_title || ""} />
            <div className="clip-result-info">
              <span className="clip-result-title">{photo.photo_title || "Untitled"}</span>
              <span className="clip-result-score">{Math.round((1 - photo.distance) * 100)}%</span>
            </div>
          </a>
        ))}
      </div>
      {!expanded && remaining > 0 && (
        <p className="summary-note" style={{ textAlign: "left", marginTop: 10 }}>
          +{fmt.format(remaining)} more
        </p>
      )}
    </article>
  );
}

export default function ObjectsPage() {
  const { data, isLoading } = useQuery<ObjectsResponse>({
    queryKey: ["objects"],
    staleTime: 5 * 60 * 1000, queryFn: () => fetch(`${BACKEND}/objects`).then((r) => r.json()),
  });

  const entries = Object.entries(data?.objects || {}).sort((a, b) => b[1].length - a[1].length);
  const totalPhotos = entries.reduce((sum, [, photos]) => sum + photos.length, 0);

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head" style={{ marginBottom: 24 }}>
          <div>
            <h2>Objects</h2>
            <p>Objects detected in your photos using CLIP vision, sorted by frequency.</p>
          </div>
          {totalPhotos > 0 && (
            <div className="summary-note">
              {fmt.format(entries.length)} object types, {fmt.format(totalPhotos)} detections
            </div>
          )}
        </div>

        {isLoading && (
          <div className="empty-state"><Spinner /></div>
        )}

        {!isLoading && entries.length === 0 && (
          <div className="empty-state">
            <div>
              <h2>No objects detected</h2>
              <p>CLIP photo embeddings are needed. Run a scan first.</p>
            </div>
          </div>
        )}

        {!isLoading && entries.map(([label, photos]) => (
          <ObjectCard key={label} label={label} photos={photos} />
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
