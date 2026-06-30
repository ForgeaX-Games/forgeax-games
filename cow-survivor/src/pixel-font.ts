// Procedural 5x7 bitmap font -> engine FontAsset (asset-free, self-contained).
//
// The engine's world-space text (GlyphText) renders through the MSDF shader
// (packages/shader/src/msdf-text.wgsl): `sd = median(rgb)`,
// `opacity = clamp((sd - 0.5) * screenPxRange + 0.5, 0, 1)`. A PLAIN
// white-on-transparent bitmap atlas (all RGB channels equal: 1 inside the
// glyph, 0 outside) renders readably through it -- inside -> opaque, outside ->
// transparent, with an fwidth()-based AA edge. So no true-MSDF generation is
// needed; a hand-authored bitmap is enough for short labels / scores.
//
// We register the atlas TextureAsset + a SamplerAsset + the FontAsset and
// return the FontAsset handle for GlyphText.fontHandle.

import type { AssetRegistry } from '@forgeax/engine-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { World } from '@forgeax/engine-ecs';
import type { FontAsset, GlyphMetric, Handle } from '@forgeax/engine-types';

// Deterministic GUIDs for the procedural font sub-assets. engine e53f4616:
// FontAsset.atlas/.sampler are AssetGuid refs (D-19), resolved at read time by
// the glyph-text layout system from the AssetRegistry catalogue.
const FONT_ATLAS_GUID = 'c0a51000-0000-5000-8000-0000000000f0';
const FONT_SAMPLER_GUID = 'c0a51000-0000-5000-8000-0000000000f1';
const FONT_GUID = 'c0a51000-0000-5000-8000-0000000000f2';

// ── 5x7 bitmap glyphs ('#' = ink, anything else = empty). Each glyph is
//    exactly 7 rows of 5 columns. ──────────────────────────────────────────
const GLYPHS: Record<string, readonly string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  ':': ['.....', '..#..', '.....', '.....', '.....', '..#..', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
};

const GW = 5; // glyph width (px)
const GH = 7; // glyph height (px)
const CELL = 8; // atlas cell stride (px) — glyph drawn top-left, 1px+ pad
const COLS = 16; // glyphs per atlas row

/**
 * Build the bitmap atlas + glyph metrics and register a FontAsset.
 * Returns its handle for GlyphText.fontHandle. Charset: 0-9 A-Z space : + -
 */
export function registerPixelFont(assets: AssetRegistry, world: World): Handle<'FontAsset', 'shared'> {
  const chars = Object.keys(GLYPHS);
  const rows = Math.ceil(chars.length / COLS);
  const atlasWidth = COLS * CELL;
  const atlasHeight = rows * CELL;
  const data = new Uint8Array(atlasWidth * atlasHeight * 4); // rgba8, zero = transparent black

  const glyphs: Record<number, GlyphMetric> = {};
  chars.forEach((ch, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const ox = col * CELL;
    const oy = row * CELL;
    const rowsBits = GLYPHS[ch]!;
    for (let gy = 0; gy < GH; gy++) {
      const line = rowsBits[gy] ?? '';
      for (let gx = 0; gx < GW; gx++) {
        if (line[gx] === '#') {
          const px = ox + gx;
          const py = oy + gy;
          const o = (py * atlasWidth + px) * 4;
          data[o] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = 255;
        }
      }
    }
    glyphs[ch.codePointAt(0) as number] = {
      advance: GW + 1,
      bearingX: 0,
      bearingY: GH,
      size: { w: GW, h: GH },
      region: { x: ox, y: oy, w: GW, h: GH },
    };
  });

  // Space: no atlas cell, advances the cursor only.
  glyphs[32] = { advance: 4, bearingX: 0, bearingY: 0, size: { w: 0, h: 0 }, region: { x: 0, y: 0, w: 0, h: 0 } };

  // engine e53f4616: `assets.register` is gone. Catalogue the atlas texture +
  // sampler under deterministic GUIDs (the FontAsset refs them by GUID, D-19),
  // catalogue the FontAsset, then mint a user-tier shared handle off the World.
  const atlasRes = AssetGuid.parse(FONT_ATLAS_GUID);
  const samplerRes = AssetGuid.parse(FONT_SAMPLER_GUID);
  const fontRes = AssetGuid.parse(FONT_GUID);
  if (!atlasRes.ok || !samplerRes.ok || !fontRes.ok) {
    throw new Error('[pixel-font] static font GUIDs failed to parse (compile-time literals)');
  }
  const atlasGuid = atlasRes.value;
  const samplerGuid = samplerRes.value;
  const fontGuid = fontRes.value;

  assets.catalog(atlasGuid, {
    kind: 'texture',
    width: atlasWidth,
    height: atlasHeight,
    format: 'rgba8unorm',
    data,
    colorSpace: 'linear',
    mipmap: false,
  });
  assets.catalog(samplerGuid, {
    kind: 'sampler',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'nearest',
  });

  const font: FontAsset = {
    kind: 'font',
    atlas: atlasGuid,
    sampler: samplerGuid,
    glyphs,
    common: {
      lineHeight: GH + 2,
      base: GH,
      distanceRange: 2,
      pxRange: 2,
      atlasWidth,
      atlasHeight,
    },
  };
  assets.catalog(fontGuid, font);
  return world.allocSharedRef<'FontAsset', FontAsset>('FontAsset', font);
}
