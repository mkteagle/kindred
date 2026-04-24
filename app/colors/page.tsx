"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Spinner } from "@/components/ui";
import type { SearchResult } from "@/types";
import { BACKEND, fmt } from "@/lib/constants";

const PRESET_COLORS = [
  { name: "Red", hex: "ff0000" },
  { name: "Orange", hex: "ff8000" },
  { name: "Yellow", hex: "ffff00" },
  { name: "Green", hex: "00ff00" },
  { name: "Blue", hex: "0000ff" },
  { name: "Purple", hex: "800080" },
  { name: "Pink", hex: "ff69b4" },
  { name: "White", hex: "ffffff" },
  { name: "Black", hex: "000000" },
  { name: "Brown", hex: "8b4513" },
];

export default function ColorsPage() {
  const [selectedHex, setSelectedHex] = useState("");
  const [hexInput, setHexInput] = useState("");
  const [threshold, setThreshold] = useState(50);

  const activeHex = selectedHex.replace(/^#/, "");

  const { data: results, isLoading } = useQuery<SearchResult[]>({
    queryKey: ["color-search", activeHex, threshold],
    staleTime: 5 * 60 * 1000, queryFn: () =>
      fetch(
        `${BACKEND}/search/color?hex=${activeHex}&threshold=${threshold}`
      ).then((r) => r.json()),
    enabled: activeHex.length === 6,
  });

  const handleSwatchClick = (hex: string) => {
    setSelectedHex(hex);
    setHexInput(hex);
  };

  const handleHexSubmit = () => {
    const cleaned = hexInput.replace(/^#/, "").trim();
    if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      setSelectedHex(cleaned);
    }
  };

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head" style={{ marginBottom: 24 }}>
          <div>
            <h2>Color Search</h2>
            <p>
              Find photos by dominant color. Pick a swatch or enter a hex code
              to search your library.
            </p>
          </div>
        </div>

        <div className="color-controls">
          <div className="color-swatches">
            {PRESET_COLORS.map((color) => (
              <button
                key={color.hex}
                className={`color-swatch ${activeHex === color.hex ? "active" : ""}`}
                style={{ backgroundColor: `#${color.hex}` }}
                onClick={() => handleSwatchClick(color.hex)}
                title={color.name}
                aria-label={color.name}
              />
            ))}
          </div>
          <div className="color-hex-input">
            <span className="color-hash">#</span>
            <input
              type="text"
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value.replace(/^#/, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleHexSubmit();
              }}
              placeholder="ff8000"
              maxLength={6}
              className="color-input"
            />
            <button className="button small" onClick={handleHexSubmit}>
              Search
            </button>
          </div>
          <label className="color-threshold-label">
            <span>Threshold</span>
            <input
              type="range"
              min={20}
              max={100}
              step={5}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="duplicates-slider"
            />
            <span className="duplicates-slider-value">{threshold}</span>
          </label>
        </div>

        {activeHex.length !== 6 && (
          <div className="empty-state" style={{ minHeight: 200 }}>
            <div>
              <h2>Pick a color</h2>
              <p>
                Select a color swatch above or enter a 6-digit hex code to find
                matching photos.
              </p>
            </div>
          </div>
        )}

        {activeHex.length === 6 && isLoading && (
          <div className="empty-state" style={{ minHeight: 200 }}>
            <Spinner />
          </div>
        )}

        {activeHex.length === 6 && !isLoading && results && results.length > 0 && (
          <>
            <p
              className="summary-note"
              style={{ textAlign: "left", marginBottom: 16 }}
            >
              {fmt.format(results.length)} results for{" "}
              <span
                className="color-preview-inline"
                style={{ backgroundColor: `#${activeHex}` }}
              />
              #{activeHex}
            </p>
            <div className="clip-results-grid">
              {results.map((result) => (
                <a
                  key={result.photo_id}
                  href={result.flickr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="clip-result-card"
                >
                  <img
                    src={result.thumb_url || result.photo_url}
                    alt={result.photo_title || "Color match"}
                  />
                  <div className="clip-result-info">
                    <span className="clip-result-title">
                      {result.photo_title || "Untitled"}
                    </span>
                    {result.distance !== undefined && (
                      <span className="clip-result-score">
                        {Math.round((1 - result.distance) * 100)}% match
                      </span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </>
        )}

        {activeHex.length === 6 && !isLoading && results && results.length === 0 && (
          <div className="empty-state" style={{ minHeight: 200 }}>
            <div>
              <h2>No results</h2>
              <p>
                No photos matched color #{activeHex} at threshold {threshold}.
                Try a different color or increase the threshold.
              </p>
            </div>
          </div>
        )}

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
