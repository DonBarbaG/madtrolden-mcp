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

/** Lowercase word tokens ("Vestergade 3, Skive" → vestergade, 3, skive). */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/** Address fields that say WHERE a hit is (not the wider municipality). */
const PLACE_FIELDS = [
  "road",
  "street",
  "house_number",
  "housenumber",
  "postcode",
  "city",
  "town",
  "village",
  "hamlet",
  "suburb",
  "quarter",
  "city_district",
  "district",
  "locality",
  "neighbourhood",
  "name",
];

/**
 * How many query words a candidate's place fields contain. Used to pick
 * among equally-ranked hits: "Vestergade 3 Skive" has a Vestergade 3 in
 * Skive, Balling AND Roslev (all Skive Kommune) — only one has town=Skive.
 */
export function matchScore(query: string, parts: Record<string, string | undefined>): number {
  const have = new Set(PLACE_FIELDS.flatMap((f) => tokens(parts[f] ?? "")));
  return tokens(query).filter((t) => have.has(t)).length;
}

/** Best-matching candidate; ties keep the service's own ranking. */
function pickBest<T>(
  query: string,
  hits: T[],
  partsOf: (h: T) => Record<string, string | undefined>,
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const h of hits) {
    const score = matchScore(query, partsOf(h));
    if (score > bestScore) {
      best = h;
      bestScore = score;
    }
  }
  return best;
}

async function nominatim(address: string): Promise<GeoPoint | null> {
  const params = new URLSearchParams({
    q: address,
    countrycodes: "dk",
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
  });
  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { "user-agent": USER_AGENT, "accept-language": "da" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Nominatim geocoding failed (${res.status})`);
  const hits = (await res.json()) as NominatimRow[];
  const hit = pickBest(address, hits, (h) => h.address ?? {});
  if (!hit) return null;
  const lat = Number.parseFloat(hit.lat);
  const lng = Number.parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: shortLabel(hit.address ?? {}, hit.display_name) };
}

/**
 * Photon is fuzzy to a fault: "hjemme hos mor" lands on a furniture shop in
 * Rødovre. As the fallback it must earn its answer — every real word (3+
 * letters) of the query has to appear in the hit, else no match.
 */
export function photonAccepts(query: string, props: Record<string, string | undefined>): boolean {
  const words = tokens(query).filter((t) => t.length >= 3 && !/^\d+$/.test(t));
  if (words.length === 0) return false;
  const have = new Set(PLACE_FIELDS.flatMap((f) => tokens(props[f] ?? "")));
  return words.every((w) => have.has(w));
}

async function photon(address: string): Promise<GeoPoint | null> {
  // Denmark's bounding box keeps "Vesterbrogade" from landing abroad.
  const params = new URLSearchParams({ q: address, limit: "5", bbox: "7.9,54.5,15.3,57.9" });
  const res = await fetch(`${PHOTON_URL}?${params}`, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Photon geocoding failed (${res.status})`);
  const { features } = (await res.json()) as { features?: PhotonFeature[] };
  const danish = (features ?? []).filter(
    (f) => (f.properties.countrycode ?? "DK").toUpperCase() === "DK",
  );
  const hit = pickBest(address, danish, (f) => f.properties);
  if (!hit || !photonAccepts(address, hit.properties)) return null;
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
