/**
 * DISABLED: injecting grass_tile.png into race_track made ForgeaX show a white
 * film (baseColor [1,1,1] + unbound texture). Lawn stays pack-PBR solid green
 * (col_0.390,0.685,0.190) via build-scene remap — see unpatch-grass-texture.mjs.
 *
 * Flower / tree density should be authored as geometry, not ground textures,
 * until pack materials support reliable baseColorTexture for large slabs.
 */
console.error(
  '[patch-grass-detail] disabled — caused white-film grass. Use solid pack PBR + LawnBed_* props.',
);
process.exit(1);
