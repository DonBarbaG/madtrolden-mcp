// Location-aware store lookup: DAWA geocoding + Tjek branch data, distances
// via haversine. Pure data out — the client AI presents it (no map rendering
// server-side, per spec §6.5).

import { getStoresNear, type StoreBranch } from "./api";
import { type GeoPoint, haversineKm, resolveLocation } from "./geo";

export interface BranchWithDistance extends StoreBranch {
  distanceKm: number;
}

export interface NearbyStores {
  origin: GeoPoint;
  radiusKm: number;
  branches: BranchWithDistance[];
  /** Chain name -> nearest branch of that chain. */
  nearestByChain: Map<string, BranchWithDistance>;
}

/**
 * All branches within radius of a location (address text or "lat,lng"),
 * distance-sorted. Returns null when the location can't be resolved.
 */
export async function findStoresNear(location: string, radiusKm = 3): Promise<NearbyStores | null> {
  const origin = await resolveLocation(location);
  if (!origin) return null;

  const raw = await getStoresNear(origin.lat, origin.lng, radiusKm);
  const branches = raw
    .map((b) => ({ ...b, distanceKm: Math.round(haversineKm(origin, b) * 10) / 10 }))
    .filter((b) => b.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.brand.localeCompare(b.brand));

  const nearestByChain = new Map<string, BranchWithDistance>();
  for (const b of branches) {
    if (!nearestByChain.has(b.brand)) nearestByChain.set(b.brand, b);
  }

  return { origin, radiusKm, branches, nearestByChain };
}

export const REGIONAL_FLYER_CAVEAT =
  "Flyer offers can vary regionally — the nearest branch is not guaranteed to carry every flyer item.";
