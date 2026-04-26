"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { Button, Spinner } from "@/components/ui";
import type { LocationsResponse, LocationGroup } from "@/types";
import { BACKEND, fmt } from "@/lib/constants";
import { useLightbox } from "@/components/photo-lightbox";
import type { LightboxPhoto } from "@/components/photo-lightbox";

// Leaflet must be loaded client-side only (no SSR)
const LocationMap = dynamic(() => import("./map"), { ssr: false });

function LocationCard({
  location,
  isSelected,
  onSelect,
}: {
  location: LocationGroup;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { openLightbox } = useLightbox();
  const preview = location.photos.slice(0, 6);
  const remaining = location.photos.length - preview.length;
  const visible = expanded ? location.photos : preview;

  const lbPhotos: LightboxPhoto[] = location.photos.map((p) => ({
    photo_id: p.photo_id,
    thumb_url: p.thumb_url,
    flickr_url: p.flickr_url,
    photo_title: p.photo_title,
  }));

  return (
    <article
      className={`location-card ${isSelected ? "location-card-selected" : ""}`}
      id={`loc-${location.name.replace(/\s+/g, "-")}`}
    >
      <div className="location-card-header">
        <div>
          <h3 className="location-card-name">
            <button className="location-pin-btn" onClick={onSelect} title="Show on map">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
            </button>
            {location.name}
          </h3>
          <span className="location-card-count">
            {fmt.format(location.count)} photo{location.count !== 1 ? "s" : ""}
            {location.lat && location.lng ? ` · ${location.lat.toFixed(2)}, ${location.lng.toFixed(2)}` : ""}
          </span>
        </div>
        {remaining > 0 && (
          <Button small variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show less" : `Show all ${fmt.format(location.count)}`}
          </Button>
        )}
      </div>
      <div className="scene-photo-grid">
        {visible.map((photo) => (
          <button key={photo.photo_id} className="clip-result-card" onClick={() => openLightbox(photo.photo_id, lbPhotos)} style={{ border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
            <img src={photo.thumb_url} alt={photo.photo_title || ""} />
            <div className="clip-result-info">
              <span className="clip-result-title">{photo.photo_title || "Untitled"}</span>
            </div>
          </button>
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

export default function LocationsPage() {
  const { data, isLoading } = useQuery<LocationsResponse>({
    queryKey: ["locations"],
    staleTime: 5 * 60 * 1000, queryFn: () => fetch(`${BACKEND}/locations`).then((r) => r.json()),
  });

  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");

  const locations = useMemo(
    () => (data?.locations || []).sort((a, b) => b.count - a.count),
    [data]
  );

  const geoLocations = useMemo(
    () => locations.filter((l) => l.lat && l.lng),
    [locations]
  );

  const totalPhotos = locations.reduce((sum, l) => sum + l.count, 0);

  const handleMapSelect = (name: string) => {
    setSelectedLocation(name);
    const el = document.getElementById(`loc-${name.replace(/\s+/g, "-")}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head" style={{ marginBottom: 16 }}>
          <div>
            <h2>Locations</h2>
            <p>Photo locations from EXIF GPS data, reverse-geocoded to place names.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {totalPhotos > 0 && (
              <span className="summary-note">
                {fmt.format(locations.length)} locations, {fmt.format(totalPhotos)} photos
              </span>
            )}
            <div style={{ display: "flex", gap: 2 }}>
              <Button small variant={viewMode === "map" ? "dark" : "ghost"} onClick={() => setViewMode("map")}>
                Map
              </Button>
              <Button small variant={viewMode === "list" ? "dark" : "ghost"} onClick={() => setViewMode("list")}>
                List
              </Button>
            </div>
          </div>
        </div>

        {isLoading && (
          <div className="cluster-grid">{Array.from({length:12}).map((_,i)=>(<div key={i} className="skeleton-card" style={{aspectRatio:"3/4",borderRadius:8}}/>))}</div>
        )}

        {!isLoading && locations.length === 0 && (
          <div className="empty-state">
            <div>
              <h2>No locations found</h2>
              <p>Run a metadata backfill to extract GPS coordinates from your photos.</p>
            </div>
          </div>
        )}

        {!isLoading && geoLocations.length > 0 && viewMode === "map" && (
          <div className="map-container" style={{ marginBottom: 24 }}>
            <LocationMap
              locations={geoLocations}
              selectedLocation={selectedLocation}
              onSelect={handleMapSelect}
            />
          </div>
        )}

        {!isLoading && locations.map((location) => (
          <LocationCard
            key={location.name}
            location={location}
            isSelected={selectedLocation === location.name}
            onSelect={() => handleMapSelect(location.name)}
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
