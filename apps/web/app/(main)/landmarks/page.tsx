"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Spinner } from "@/components/ui";
import type { ScenesResponse, SceneGroup } from "@/types";
import { BACKEND } from "@/lib/constants";
import { useLightbox } from "@/components/photo-lightbox";
import type { LightboxPhoto } from "@/components/photo-lightbox";

const SCENE_LABELS = [
  "beach",
  "mountain",
  "city",
  "forest",
  "indoor",
  "church",
  "sunset",
  "snow",
  "water",
  "park",
  "restaurant",
  "garden",
  "desert",
  "bridge",
  "castle",
  "playground",
  "stadium",
  "airport",
  "school",
  "wedding",
  "birthday party",
  "concert",
  "museum",
];

function SceneCard({
  label,
  photos,
}: {
  label: string;
  photos: SceneGroup[];
}) {
  const { openLightbox } = useLightbox();
  const [expanded, setExpanded] = useState(false);
  const preview = photos.slice(0, 6);
  const remaining = photos.length - preview.length;

  return (
    <article className="scene-card">
      <div className="scene-card-header">
        <div>
          <h3 className="scene-card-label">{label}</h3>
          <span className="scene-card-count">
            {photos.length} photo{photos.length !== 1 ? "s" : ""}
          </span>
        </div>
        {photos.length > 6 && (
          <Button
            small
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show less" : `Show all ${photos.length}`}
          </Button>
        )}
      </div>
      <div className="scene-photo-grid">
        {(expanded ? photos : preview).map((photo) => {
          const lbPhotos: LightboxPhoto[] = photos.map((p) => ({
            photo_id: p.photo_id, thumb_url: p.thumb_url || p.photo_url, flickr_url: p.flickr_url, photo_url: p.photo_url, photo_title: p.photo_title,
          }));
          return (
            <button
              key={photo.photo_id}
              className="clip-result-card"
              onClick={() => openLightbox(photo.photo_id, lbPhotos)}
              style={{ border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
            >
              <img
                src={photo.thumb_url || photo.photo_url}
                alt={photo.photo_title || label}
              />
              <div className="clip-result-info">
                <span className="clip-result-title">
                  {photo.photo_title || "Untitled"}
                </span>
                <span className="clip-result-score">
                  {Math.round((1 - photo.distance) * 100)}% match
                </span>
            </div>
          </button>
          );
        })}
      </div>
      {!expanded && remaining > 0 && (
        <p
          className="summary-note"
          style={{ textAlign: "left", marginTop: 10 }}
        >
          +{remaining} more photo{remaining !== 1 ? "s" : ""}
        </p>
      )}
    </article>
  );
}

export default function LandmarksPage() {
  const { data, isLoading } = useQuery<ScenesResponse>({
    queryKey: ["scenes"],
    staleTime: 5 * 60 * 1000, queryFn: () => fetch(`${BACKEND}/scenes`).then((r) => r.json()),
  });

  const scenes = data?.scenes || {};
  const sortedLabels = Object.keys(scenes).sort(
    (a, b) => scenes[b].length - scenes[a].length
  );
  const totalPhotos = sortedLabels.reduce(
    (sum, l) => sum + scenes[l].length,
    0
  );

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head" style={{ marginBottom: 24 }}>
          <div>
            <h2>Landmarks &amp; Scenes</h2>
            <p>
              Auto-detected scene types across your photo library, classified
              using CLIP vision. Each card groups photos that match a scene
              category.
            </p>
          </div>
          {totalPhotos > 0 && (
            <div className="summary-note">
              {sortedLabels.length} scenes, {totalPhotos} photos
            </div>
          )}
        </div>

        {isLoading && (
          <div className="empty-state">
            <div className="cluster-grid">{Array.from({length:12}).map((_,i)=>(<div key={i} className="skeleton-card" style={{aspectRatio:"3/4",borderRadius:8}}/>))}</div>
          </div>
        )}

        {!isLoading && sortedLabels.length === 0 && (
          <div className="empty-state">
            <div>
              <h2>No scenes detected</h2>
              <p>
                Scene classification requires photo CLIP embeddings. Make sure
                you have scanned photos first.
              </p>
            </div>
          </div>
        )}

        {!isLoading &&
          sortedLabels.map((label) => (
            <SceneCard
              key={label}
              label={label}
              photos={scenes[label]}
            />
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
