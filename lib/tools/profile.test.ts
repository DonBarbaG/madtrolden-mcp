/**
 * Phase-2 acceptance tests: client-held profile state.
 *
 * Uses the REAL store module (no mocks) inside an account context, so these
 * tests pin down the properties the remote server depends on:
 *   - import → read → export round-trips identically
 *   - cold start (RAM wipe) + re-import restores identical behavior
 *   - accounts are isolated from each other
 *   - HTTP-mode (account context) never touches disk
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool, createServerStub, type ServerStub, textOf } from "../../test/mcp-harness";
import { runWithAccount } from "../http/context";
import { clearRamProfiles, type DataStore } from "../store";
import { registerProfileTools } from "./profile";

const SENTINEL_PATH = path.join(os.tmpdir(), `madtrolden-test-store-${process.pid}.json`);

function makeProfile(overrides: Partial<DataStore> = {}): DataStore {
  return {
    household: {
      people: [
        { name: "Ludwig", dietaryRestrictions: ["no-pork"], defaultSchedule: { monday: true } },
        { name: "Mor", dietaryRestrictions: [], defaultSchedule: {} },
      ],
      stores: [{ name: "Netto", dealerId: "9ba51", priority: 1 }],
      defaultServings: 2,
      country: "DK",
    },
    pantry: ["salt", "peber", "olie"],
    recipes: [
      {
        name: "Testret",
        ingredients: [
          { name: "kartofler", quantity: "1 kg", searchTerms: ["kartofler"], category: "produce" },
        ],
        servings: 2,
        complexity: "quick",
        cuisineType: "danish",
        proteinType: "vegetarian",
      },
    ],
    mealHistory: [{ date: "2026-08-01", recipe: "Testret", people: ["Ludwig"] }],
    spendLog: [{ date: "2026-08-01", store: "Netto", estimatedTotal: 250, items: 12, notes: "" }],
    ...overrides,
  };
}

let stub: ServerStub;

beforeEach(() => {
  // If the RAM backend ever fell through to the file backend, this sentinel
  // file would be created — the disk-write assertions below watch for it.
  process.env.TILBUDSTROLDEN_DATA = SENTINEL_PATH;
  clearRamProfiles();
  stub = createServerStub();
  registerProfileTools(stub.server);
});

afterEach(() => {
  delete process.env.TILBUDSTROLDEN_DATA;
  clearRamProfiles();
});

function extractBlob(exportText: string): DataStore {
  const jsonStart = exportText.indexOf("{");
  return JSON.parse(exportText.slice(jsonStart)) as DataStore;
}

describe("profile tools (HTTP account context)", () => {
  it("registers export_profile and import_profile", () => {
    expect([...stub.tools.keys()].sort()).toEqual(["export_profile", "import_profile"]);
  });

  it("round-trips import → export identically", async () => {
    const profile = makeProfile();
    await runWithAccount("ludwig", async () => {
      const res = await callTool(stub, "import_profile", { profile });
      expect(textOf(res)).toContain("Profile imported for ludwig");
      expect(textOf(res)).toContain("2 people");

      const exported = await callTool(stub, "export_profile", {});
      expect(extractBlob(textOf(exported))).toEqual(profile);
    });
  });

  it("accepts the blob as a JSON string too", async () => {
    const profile = makeProfile();
    await runWithAccount("ludwig", async () => {
      const res = await callTool(stub, "import_profile", { profile: JSON.stringify(profile) });
      expect(textOf(res)).toContain("Profile imported");
    });
  });

  it("restores identical state after a cold start plus re-import", async () => {
    const profile = makeProfile();
    const before = await runWithAccount("ludwig", async () => {
      await callTool(stub, "import_profile", { profile });
      return extractBlob(textOf(await callTool(stub, "export_profile", {})));
    });

    clearRamProfiles(); // simulated cold start / instance recycle

    const after = await runWithAccount("ludwig", async () => {
      const empty = extractBlob(textOf(await callTool(stub, "export_profile", {})));
      expect(empty.household.people).toEqual([]); // really was wiped
      await callTool(stub, "import_profile", { profile });
      return extractBlob(textOf(await callTool(stub, "export_profile", {})));
    });

    expect(after).toEqual(before);
  });

  it("keeps accounts isolated from each other", async () => {
    const profile = makeProfile();
    await runWithAccount("ludwig", () => callTool(stub, "import_profile", { profile }));

    const other = await runWithAccount("far", async () =>
      extractBlob(textOf(await callTool(stub, "export_profile", {}))),
    );
    expect(other.household.people).toEqual([]);
    expect(other.pantry).toEqual([]);
  });

  it("rejects an invalid blob loudly and imports nothing", async () => {
    await runWithAccount("ludwig", async () => {
      const res = await callTool(stub, "import_profile", {
        profile: { household: { defaultServings: "many" } },
      });
      expect(textOf(res)).toContain("failed validation");

      const exported = extractBlob(textOf(await callTool(stub, "export_profile", {})));
      expect(exported.household.people).toEqual([]);
    });
  });

  it("never writes to disk while in an account context", async () => {
    const profile = makeProfile();
    await runWithAccount("ludwig", async () => {
      await callTool(stub, "import_profile", { profile });
      await callTool(stub, "export_profile", {});
    });
    expect(existsSync(SENTINEL_PATH)).toBe(false);
  });
});
