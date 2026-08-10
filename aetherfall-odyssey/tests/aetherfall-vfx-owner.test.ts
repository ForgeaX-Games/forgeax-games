import {
  findParticleRenderFeatureOwner,
  PARTICLE_RENDER_FEATURE_ID,
} from "../assets/plugins/vfx-hit-loop";
import { describe, expect, it } from "vitest";

describe("Aetherfall VFX RenderFeature ownership", () => {
  it("reuses the existing particle feature owner by its stable identity", () => {
    const owner = {
      identity: PARTICLE_RENDER_FEATURE_ID,
      status: "active" as const,
    };
    const diagnostics = [
      { identity: "forgeax.debug.axes", status: "active" as const },
      owner,
    ];

    expect(findParticleRenderFeatureOwner(diagnostics)).toBe(owner);
  });

  it("does not mistake another renderer feature for the particle owner", () => {
    expect(
      findParticleRenderFeatureOwner([
        { identity: "forgeax.debug.axes" },
        { identity: "forgeax::tonemap" },
      ]),
    ).toBeUndefined();
  });
});
