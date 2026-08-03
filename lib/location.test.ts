/** Phase-5 tests: geocoding parse, haversine, branch filtering/sorting. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { haversineKm, resolveLocation } from "./geo";

vi.mock("./api", () => ({
  getStoresNear: vi.fn(),
}));

const api = await import("./api");
const { findStoresNear } = await import("./location");

const KBH = { lat: 55.6761, lng: 12.5683 }; // København centrum
const AARHUS = { lat: 56.1629, lng: 10.2039 };

describe("haversineKm", () => {
  it("is ~0 for identical points", () => {
    expect(haversineKm(KBH, KBH)).toBeCloseTo(0, 5);
  });

  it("København → Aarhus is ~157 km", () => {
    const d = haversineKm(KBH, AARHUS);
    expect(d).toBeGreaterThan(140);
    expect(d).toBeLessThan(175);
  });
});

describe("resolveLocation", () => {
  it("parses lat,lng directly without network", async () => {
    const p = await resolveLocation("55.667, 12.545");
    expect(p).toEqual({ lat: 55.667, lng: 12.545, label: "55.66700, 12.54500" });
  });
});

describe("findStoresNear", () => {
  beforeEach(() => vi.clearAllMocks());

  function branch(id: string, brand: string, lat: number, lng: number) {
    return {
      id,
      name: `${brand} ${id}`,
      street: "Testgade 1",
      city: "København V",
      zip: "1650",
      lat,
      lng,
      dealerId: `dlr-${brand}`,
      brand,
    };
  }

  it("sorts by distance and maps nearest branch per chain", async () => {
    vi.mocked(api.getStoresNear).mockResolvedValue([
      branch("far", "Netto", 55.685, 12.545), // ~2 km north
      branch("near", "Netto", 55.668, 12.546), // ~0.1 km
      branch("mid", "REMA 1000", 55.672, 12.55), // ~0.6 km
    ]);

    const result = await findStoresNear("55.667,12.545", 3);
    expect(result).not.toBeNull();
    expect(result?.branches.map((b) => b.id)).toEqual(["near", "mid", "far"]);
    expect(result?.nearestByChain.get("Netto")?.id).toBe("near");
    expect(result?.nearestByChain.get("REMA 1000")?.id).toBe("mid");
    expect(result?.branches[0].distanceKm).toBeLessThan(0.3);
  });

  it("filters out branches beyond the radius (API radius is approximate)", async () => {
    vi.mocked(api.getStoresNear).mockResolvedValue([
      branch("inside", "Netto", 55.668, 12.546),
      branch("outside", "Bilka", 55.75, 12.4), // ~13 km away
    ]);
    const result = await findStoresNear("55.667,12.545", 3);
    expect(result?.branches.map((b) => b.id)).toEqual(["inside"]);
  });
});
