"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LocationGroup } from "@/types";
import { fmt } from "@/lib/constants";

// Fix Leaflet default marker icons in Next.js
const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const activeIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [30, 49],
  iconAnchor: [15, 49],
  popupAnchor: [1, -40],
  shadowSize: [49, 49],
  className: "marker-active",
});

function FitBounds({ locations }: { locations: LocationGroup[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || locations.length === 0) return;
    const bounds = L.latLngBounds(
      locations.map((l) => [l.lat, l.lng] as [number, number])
    );
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
    const loc = locations.find((l) => l.name === selectedLocation);
    if (loc) {
      map.flyTo([loc.lat, loc.lng], 13, { duration: 0.8 });
    }
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
  if (locations.length === 0) return null;

  const center: [number, number] = [
    locations.reduce((s, l) => s + l.lat, 0) / locations.length,
    locations.reduce((s, l) => s + l.lng, 0) / locations.length,
  ];

  return (
    <MapContainer
      center={center}
      zoom={4}
      style={{ height: 420, width: "100%", borderRadius: 12 }}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds locations={locations} />
      <FlyToSelected locations={locations} selectedLocation={selectedLocation} />
      {locations.map((loc) => (
        <Marker
          key={loc.name}
          position={[loc.lat, loc.lng]}
          icon={selectedLocation === loc.name ? activeIcon : markerIcon}
          eventHandlers={{ click: () => onSelect(loc.name) }}
        >
          <Popup>
            <div style={{ fontFamily: "inherit", minWidth: 140 }}>
              <strong style={{ fontSize: 14 }}>{loc.name}</strong>
              <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
                {fmt.format(loc.count)} photo{loc.count !== 1 ? "s" : ""}
              </div>
              {loc.photos[0] && (
                <img
                  src={loc.photos[0].thumb_url}
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
