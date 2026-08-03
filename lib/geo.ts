// Danish geocoding via DAWA (api.dataforsyningen.dk — official, free, no key)
// plus haversine distance. Attribution: Danmarks Adressers Web API (DAWA),
// Klimadatastyrelsen / SDFI.

import { TtlCache } from "./cache";

const DAWA_BASE = "https://api.dataforsyningen.dk";
const FETCH_TIMEOUT_MS = 8000;

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Human-readable resolved address (when geocoded from text). */
  label?: string;
}

const geocodeCache = new TtlCache<GeoPoint | null>(24 * 60 * 60 * 1000, "dawa/geocode");

interface DawaAutocompleteRow {
  tekst: string;
  data: { x?: number; y?: number };
}

/**
 * Geocode a Danish address via DAWA autocomplete (fuzzy, handles partial
 * addresses). Returns null when nothing matches. NOTE: DAWA returns
 * x = longitude, y = latitude.
 */
export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const key = address.trim().toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached !== undefined) return cached;

  const params = new URLSearchParams({ q: address, per_side: "1", type: "adresse", fuzzy: "" });
  const res = await fetch(`${DAWA_BASE}/autocomplete?${params}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DAWA geocoding failed (${res.status})`);
  const rows = (await res.json()) as DawaAutocompleteRow[];
  const hit = rows.find((r) => typeof r.data?.x === "number" && typeof r.data?.y === "number");
  const point = hit
    ? { lat: hit.data.y as number, lng: hit.data.x as number, label: hit.tekst }
    : null;
  geocodeCache.set(key, point);
  return point;
}

/** Great-circle distance in km. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Resolve a user-supplied location: "lat,lng" pair or a Danish address.
 * Returns null when the address can't be geocoded.
 */
export async function resolveLocation(input: string): Promise<GeoPoint | null> {
  const coordMatch = input.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = Number.parseFloat(coordMatch[1]);
    const lng = Number.parseFloat(coordMatch[2]);
    if (lat >= 54 && lat <= 58.5 && lng >= 7 && lng <= 16) {
      return { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
    }
    // Coordinates outside Denmark: still accept, but the store lookup will
    // simply find nothing nearby.
    return { lat, lng, label: `${lat}, ${lng}` };
  }
  return geocodeAddress(input);
}

export const DAWA_ATTRIBUTION =
  "Geocoding: DAWA (Danmarks Adressers Web API), api.dataforsyningen.dk";
