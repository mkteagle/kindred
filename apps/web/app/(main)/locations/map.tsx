"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LocationGroup } from "@/types";
import { fmt } from "@/lib/constants";
import { useTheme } from "@/components/kx/theme";

/**
 * Tiles follow the chrome. A near-black page with a bright street map on it
 * reads as two applications; the dark basemap is the one the design asks for.
 */
const TILES = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  light: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
} as const;

const ACCENT = "#cc7f61";
const AMBER = "#d59851";

/**
 * An ember pin: a filled dot with a ring, drawn rather than fetched, so the
 * map does not pull marker images off a CDN and does not need recolouring to
 * match the palette. The active pin is larger and takes the amber.
 */
function pin(active: boolean): L.DivIcon {
  const size = active ? 22 : 15;
  const colour = active ? AMBER : ACCENT;
  return L.divIcon({
    className: "kx-mappin",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:999px;background:${colour};box-shadow:0 0 0 3px rgba(204,127,97,.28),0 2px 8px rgba(0,0,0,.45);"></span>`,
  });
}

function FitBounds({ locations }: { locations: LocationGroup[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || locations.length === 0) return;
    const bounds = L.latLngBounds(locations.map((l) => [l.lat, l.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    fitted.current = true;
  }, [locations, map]);

  return null;
}

function FlyToSelected({
  locations,
  selectedLocation,
}: {
  locations: LocationGroup[];
  selectedLocation: string | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!selectedLocation) return;
    const location = locations.find((l) => l.name === selectedLocation);
    if (location) map.flyTo([location.lat, location.lng], 13, { duration: 0.8 });
  }, [selectedLocation, locations, map]);

  return null;
}

export default function LocationMap({
  locations,
  selectedLocation,
  onSelect,
}: {
  locations: LocationGroup[];
  selectedLocation: string | null;
  onSelect: (name: string) => void;
}) {
  const { theme } = useTheme();
  const tiles = TILES[theme] ?? TILES.dark;

  const center = useMemo<[number, number]>(
    () => [
      locations.reduce((sum, l) => sum + l.lat, 0) / Math.max(locations.length, 1),
      locations.reduce((sum, l) => sum + l.lng, 0) / Math.max(locations.length, 1),
    ],
    [locations],
  );

  if (locations.length === 0) return null;

  return (
    <MapContainer
      center={center}
      zoom={4}
      // The pane owns the height; the map fills whatever it is given.
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
    >
      {/* Keyed so a theme change swaps the basemap rather than layering one
          over the other. */}
      <TileLayer key={theme} attribution={tiles.attribution} url={tiles.url} />
      <FitBounds locations={locations} />
      <FlyToSelected locations={locations} selectedLocation={selectedLocation} />
      {locations.map((location) => (
        <Marker
          key={location.name}
          position={[location.lat, location.lng]}
          icon={pin(selectedLocation === location.name)}
          eventHandlers={{ click: () => onSelect(location.name) }}
        >
          <Popup>
            <div style={{ fontFamily: "inherit", minWidth: 140 }}>
              <strong style={{ fontSize: 14 }}>{location.name}</strong>
              <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
                {fmt.format(location.count)} photo{location.count !== 1 ? "s" : ""}
              </div>
              {location.photos[0] && (
                <img
                  src={location.photos[0].thumb_url}
                  alt=""
                  style={{ width: "100%", borderRadius: 6, marginTop: 8 }}
                />
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
