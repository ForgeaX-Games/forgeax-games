import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface Metrics {
  readonly logicalTextureCount: number;
  readonly uniquePayloadCount: number;
  readonly compressedReferenceBytes: number;
  readonly compressedUniqueBytes: number;
  readonly fullMipRgba8ReferenceBytes: number;
  readonly fullMipRgba8UniqueBytes: number;
}

interface ResidencyAudit {
  readonly assumption: string;
  readonly totals: {
    readonly cataloged: Metrics;
    readonly productionReferenced: Metrics;
    readonly embedded: Metrics;
    readonly standalone: Metrics;
  };
  readonly duplicatePayloads: readonly unknown[];
  readonly owners: ReadonlyArray<{
    readonly owner: string;
    readonly active: boolean;
    readonly publicReferenceFiles: readonly string[];
    readonly logicalTextureCount: number;
    readonly uniquePayloadCount: number;
    readonly fullMipRgba8UniqueBytes: number;
    readonly reusedTextureIndices: readonly unknown[];
  }>;
  readonly textures: ReadonlyArray<{
    readonly active: boolean;
    readonly publicGuid: string | null;
    readonly payloadSha256: string;
    readonly width: number;
    readonly height: number;
    readonly fullMipRgba8Bytes: number;
  }>;
}

const gameRoot = fileURLToPath(new URL("../", import.meta.url));
const evidenceRoot = new URL(
  "../../../evidence/aetherfall-odyssey/staging/production-texture-residency-20260808/",
  import.meta.url,
);
const script = fileURLToPath(
  new URL("scripts/audit-texture-residency.mjs", evidenceRoot),
);

function currentAudit(): ResidencyAudit {
  return JSON.parse(
    execFileSync("node", [script, gameRoot], { encoding: "utf8" }),
  ) as ResidencyAudit;
}

describe("production logical texture residency contract", () => {
  it("pins the live byte inventory to the retained audit", () => {
    const current = currentAudit();
    const retained = JSON.parse(
      readFileSync(new URL("residency-audit.json", evidenceRoot), "utf8"),
    ) as ResidencyAudit;
    expect(current).toEqual(retained);
  });

  it("separates catalog bytes from production references without calling either measured VRAM", () => {
    const audit = currentAudit();
    expect(audit.assumption).toContain("Static logical upper bound only");
    expect(audit.assumption).toContain("not measured VRAM");
    expect(audit.totals).toEqual({
      cataloged: {
        logicalTextureCount: 48,
        uniquePayloadCount: 48,
        compressedReferenceBytes: 33_923_855,
        compressedUniqueBytes: 33_923_855,
        fullMipRgba8ReferenceBytes: 268_435_392,
        fullMipRgba8UniqueBytes: 268_435_392,
      },
      productionReferenced: {
        logicalTextureCount: 44,
        uniquePayloadCount: 44,
        compressedReferenceBytes: 28_074_655,
        compressedUniqueBytes: 28_074_655,
        fullMipRgba8ReferenceBytes: 246_065_776,
        fullMipRgba8UniqueBytes: 246_065_776,
      },
      embedded: {
        logicalTextureCount: 36,
        uniquePayloadCount: 36,
        compressedReferenceBytes: 16_628_209,
        compressedUniqueBytes: 16_628_209,
        fullMipRgba8ReferenceBytes: 201_326_544,
        fullMipRgba8UniqueBytes: 201_326_544,
      },
      standalone: {
        logicalTextureCount: 12,
        uniquePayloadCount: 12,
        compressedReferenceBytes: 17_295_646,
        compressedUniqueBytes: 17_295_646,
        fullMipRgba8ReferenceBytes: 67_108_848,
        fullMipRgba8UniqueBytes: 67_108_848,
      },
    });
  });

  it("finds no byte-identical payload eligible for authority-safe deduplication", () => {
    const audit = currentAudit();
    expect(audit.duplicatePayloads).toEqual([]);
    expect(new Set(audit.textures.map((texture) => texture.payloadSha256)).size).toBe(48);
    expect(
      audit.textures.every(
        (texture) =>
          texture.width === 1_024 &&
          texture.height === 1_024 &&
          texture.fullMipRgba8Bytes === 5_592_404 &&
          texture.publicGuid !== null,
      ),
    ).toBe(true);
  });

  it("retains exact owner authority and treats shared ARM slots as one texture view", () => {
    const audit = currentAudit();
    expect(
      audit.owners.map((owner) => [
        owner.owner,
        owner.active,
        owner.logicalTextureCount,
        owner.uniquePayloadCount,
        owner.fullMipRgba8UniqueBytes,
      ]),
    ).toEqual([
      ["model:hero-observatory/hero-observatory.glb", true, 27, 27, 150_994_908],
      ["model:polyhaven-gothic-statue/gothic_statue_1k.glb", true, 3, 3, 16_777_212],
      ["model:polyhaven-large-castle-door/large_castle_door_1k.glb", true, 3, 3, 16_777_212],
      ["model:polyhaven-rock-face-01/rock_face_01_1k.glb", true, 3, 3, 16_777_212],
      ["model:quaternius-animated-fox/Fox.gltf", true, 0, 0, 0],
      ["standalone:aetherfall-basalt-v1", true, 4, 4, 22_369_616],
      ["standalone:aetherfall-ruin-stone-v1", true, 4, 4, 22_369_616],
      ["standalone:aetherfall-storm-bark-v1", false, 4, 4, 22_369_616],
    ]);
    expect(
      audit.owners.filter((owner) => owner.active).every(
        (owner) => owner.publicReferenceFiles.length > 0,
      ),
    ).toBe(true);
    expect(
      audit.owners.filter((owner) => owner.reusedTextureIndices.length > 0).map(
        (owner) => owner.owner,
      ),
    ).toEqual([
      "model:polyhaven-gothic-statue/gothic_statue_1k.glb",
      "model:polyhaven-large-castle-door/large_castle_door_1k.glb",
      "model:polyhaven-rock-face-01/rock_face_01_1k.glb",
    ]);
  });
});
