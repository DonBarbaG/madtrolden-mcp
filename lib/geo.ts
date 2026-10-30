// Danish geocoding via OpenStreetMap — Nominatim first, Photon (komoot) as
// fallback; both free, no key. (DAWA, api.dataforsyningen.dk, shut down in
// 2026 and answers 410 Gone.) Results are cached 24h, so we stay far inside
// Nominatim's 1 req/s policy, and every request carries a descriptive
// User-Agent as the policy asks. Plus haversine distance.

import { TtlCache } from "./cache";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const PHOTON_URL = "https://photon.komoot.io/api/";
const USER_AGENT = "nemtogbilligt-madplan/0.6 (private family meal planner)";
const FETCH_TIMEOUT_MS = 8000;

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Human-readable resolved address (when geocoded from text). */
  label?: string;
}

const geocodeCache = new TtlCache<GeoPoint | null>(24 * 60 * 60 * 1000, "osm/geocode");

interface NominatimRow {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string | undefined>;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
}

/** "Istedgade 10, 1650 København V" from address parts (falls back to `full`). */
export function shortLabel(parts: Record<string, string | undefined>, full: string): string {
  const street = [parts.road ?? parts.street, parts.house_number ?? parts.housenumber]
    .filter(Boolean)
    .join(" ");
  const town = [
    parts.postcode,
    parts.city ?? parts.town ?? parts.village ?? parts.suburb ?? parts.locality,
  ]
    .filter(Boolean)
    .join(" ");
  const label = [street, town].filter(Boolean).join(", ");
  return label || full;
}

async function nominatim(address: string): Promise<GeoPoint | null> {
  const params = new URLSearchParams({
    q: address,
    countrycodes: "dk",
    format: "jsonv2",
    addressdetails: "1",
    limit: "1",
  });
  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { "user-agent": USER_AGENT, "accept-language": "da" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Nominatim geocoding failed (${res.status})`);
  const [hit] = (await res.json()) as NominatimRow[];
  if (!hit) return null;
  const lat = Number.parseFloat(hit.lat);
  const lng = Number.parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: shortLabel(hit.address ?? {}, hit.display_name) };
}

async function photon(address: string): Promise<GeoPoint | null> {
  // Denmark's bounding box keeps "Vesterbrogade" from landing abroad.
  const params = new URLSearchParams({ q: address, limit: "1", bbox: "7.9,54.5,15.3,57.9" });
  const res = await fetch(`${PHOTON_URL}?${params}`, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Photon geocoding failed (${res.status})`);
  const { features } = (await res.json()) as { features?: PhotonFeature[] };
  const hit = features?.[0];
  if (!hit) return null;
  const [lng, lat] = hit.geometry.coordinates;
  return { lat, lng, label: shortLabel(hit.properties, address) };
}

/**
 * Geocode a Danish address (fuzzy, handles partial addresses). Returns null
 * when nothing matches; throws only when BOTH services are down.
 */
export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const key = address.trim().toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached !== undefined) return cached;

  let point: GeoPoint | null;
  try {
    point = (await nominatim(address)) ?? (await photon(address));
  } catch (err) {
    console.error("[geo] nominatim failed, trying photon:", err);
    point = await photon(address);
  }
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

export const GEOCODING_ATTRIBUTION =
  "Geocoding: © OpenStreetMap contributors (ODbL) via Nominatim / Photon";
