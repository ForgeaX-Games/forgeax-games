import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    environment: "node",
    name: "@forgeax/game-aetherfall-odyssey",
    // Keep this project narrowly scoped to authored Pack contracts; the
    // template's DOM tests are browser-owned elsewhere.
    include: [
      "tests/vfx-effect-assets.test.ts",
      "tests/aetherfall-vfx-owner.test.ts",
      "tests/ui-manifest.test.ts",
      "tests/asset-lab-actions.test.ts",
      "tests/target-profile-loop.test.ts",
      "tests/video-texture-panel.test.ts",
      "tests/gameplay-aim.test.ts",
      "tests/gameplay-input.integration.test.ts",
      "tests/player-movement-v19.test.ts",
      "tests/exploration-state.test.ts",
      "tests/exploration-system.test.ts",
      "tests/exploration-hud.test.ts",
      "tests/exploration-world-feedback.test.ts",
      "tests/runtime-safety.test.ts",
      "tests/atmospheric-fog.test.ts",
      "tests/lighting-rig.test.ts",
      "tests/hero-observatory.test.ts",
      "tests/threshold-monument.test.ts",
      "tests/rock-face-framing.test.ts",
      "tests/fox-player-lifecycle.test.ts",
      "tests/gameplay-audio-lifecycle.test.ts",
      "tests/traversal-boundary.test.ts",
      "tests/hero-terrace.test.ts",
      "tests/scene-runtime-cleanup.test.ts",
      "tests/procedural-world-lifecycle.test.ts",
      "tests/production-environment-assets.test.ts",
      "tests/camera-framing-v11.test.ts",
    ],
    exclude: ["**/node_modules/**"],
  },
});
