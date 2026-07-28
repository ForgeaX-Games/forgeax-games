import { describe, expect, test } from 'bun:test';
import {
  SPRITE_SHEETS,
  fbm2,
  loadPngSheet,
  mulberry32,
  spriteSheetById,
  upgradeSheetFromPng,
  valueNoise2Tileable,
  type SpriteSheetSpec,
} from './textures';

describe('procedural sprite sheets (PR8 T2)', () => {
  test('registry is non-empty and ids are unique', () => {
    expect(SPRITE_SHEETS.length).toBeGreaterThan(0);
    const ids = new Set(SPRITE_SHEETS.map((s) => s.id));
    expect(ids.size).toBe(SPRITE_SHEETS.length);
  });

  for (const spec of SPRITE_SHEETS) {
    test(`${spec.id} generates an atlas of the declared dims`, () => {
      const { width, height, data } = spec.generate();
      expect(width).toBe(spec.cols * spec.frameW);
      expect(height).toBe(spec.rows * spec.frameH);
      expect(spec.cols * spec.rows).toBe(spec.frames);
      expect(data.length).toBe(width * height * 4);
      // Alpha stays byte-ranged and the sheet is not uniformly transparent.
      let minA = 255;
      let maxA = 0;
      for (let i = 3; i < data.length; i += 4) {
        const a = data[i]!;
        if (a < minA) minA = a;
        if (a > maxA) maxA = a;
      }
      expect(minA).toBeGreaterThanOrEqual(0);
      expect(maxA).toBeLessThanOrEqual(255);
      expect(maxA).toBeGreaterThan(0);
    });

    test(`${spec.id} generation is deterministic`, () => {
      const a = spec.generate();
      const b = spec.generate();
      expect(a.width).toBe(b.width);
      expect(a.height).toBe(b.height);
      expect(a.data.length).toBe(b.data.length);
      for (let i = 0; i < a.data.length; i++) {
        if (a.data[i] !== b.data[i]) throw new Error(`byte ${i} diverged`);
      }
    });

    test(`${spec.id} carries declared provenance (procedural or CC0-backed)`, () => {
      if (spec.source === 'procedural') {
        expect(spec.license).toBe('team-owned');
        expect(spec.attribution).toBe('');
      } else {
        // CC0-backed sheets name the pack their boot upgrade loads.
        expect(spec.source).toBe('kenney-particle-pack');
        expect(spec.license).toBe('CC0-1.0');
        expect(spec.attribution.length).toBeGreaterThan(0);
      }
      expect(spec.usage.length).toBeGreaterThan(0);
    });
  }

  test('spriteSheetById resolves every registry id; unknown → undefined', () => {
    for (const spec of SPRITE_SHEETS) expect(spriteSheetById(spec.id)).toBe(spec);
    expect(spriteSheetById('does-not-exist')).toBeUndefined();
  });


  test('assets/vfx/provenance.json covers every registry sheet', async () => {
    const manifest = await Bun.file(
      `${import.meta.dir}/../../assets/vfx/provenance.json`,
    ).json() as {
      version: number;
      textures: Array<{
        id: string;
        path: string | null;
        sha256: string | null;
        files?: Array<{ path: string; sha256: string }>;
        source: string;
        sourceUrl?: string;
        downloaded?: string;
        license: string;
        licenseDeed?: string;
        attribution: string;
        usage: string;
      }>;
    };
    expect(manifest.version).toBe(1);
    const rows = new Map(manifest.textures.map((t) => [t.id, t]));
    expect(rows.size).toBe(manifest.textures.length);
    for (const spec of SPRITE_SHEETS) {
      const row = rows.get(spec.id);
      expect(row, `manifest row for "${spec.id}"`).toBeDefined();
      // The registry is the SSOT — the manifest mirrors it 1:1.
      expect(row!.source).toBe(spec.source);
      expect(row!.license).toBe(spec.license);
      expect(row!.attribution).toBe(spec.attribution);
      expect(row!.usage).toBe(spec.usage);
      if (spec.source === 'procedural') {
        // Procedural rows: no shipped files, team-owned.
        expect(row!.path).toBeNull();
        expect(row!.sha256).toBeNull();
        expect(row!.files ?? []).toEqual([]);
      } else {
        // CC0-backed rows REQUIRE shipped files + hashes + attribution.
        expect(typeof row!.path).toBe('string');
        expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(row!.attribution.length).toBeGreaterThan(0);
        expect(row!.sourceUrl).toContain('kenney.nl');
        expect(row!.licenseDeed).toContain('creativecommons.org/publicdomain/zero/1.0');
        expect(row!.downloaded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(row!.files, `files for "${spec.id}"`).toBeDefined();
        expect(row!.files!.length).toBe(spec.frames);
        const frameShas: string[] = [];
        for (const f of row!.files!) {
          expect(f.path.startsWith(`${row!.path}/`)).toBe(true);
          expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
          // Recompute from disk — the manifest must match the shipped bytes.
          const bytes = await Bun.file(`${import.meta.dir}/../../${f.path}`).arrayBuffer();
          const actual = new Bun.CryptoHasher('sha256').update(new Uint8Array(bytes)).digest('hex');
          expect(actual, `sha256 of ${f.path}`).toBe(f.sha256);
          frameShas.push(f.sha256);
        }
        // Row sha = composite: sha256 of the frame shas in flipbook order.
        const composite = new Bun.CryptoHasher('sha256').update(frameShas.join('\n')).digest('hex');
        expect(row!.sha256).toBe(composite);
      }
    }
  });
});

describe('runtime PNG route (PR8 T9a)', () => {
  test('loadPngSheet rejects a frame-count mismatch before any fetch', async () => {
    await expect(loadPngSheet(['a.png'], { cols: 2, rows: 2, frames: 4 }))
      .rejects.toThrow('expected 4 frame urls, got 1');
  });

  test('loadPngSheet rejects frames that do not fit the grid', async () => {
    await expect(loadPngSheet(['a', 'b', 'c', 'd', 'e'], { cols: 2, rows: 2, frames: 5 }))
      .rejects.toThrow('do not fit');
  });

  test('upgradeSheetFromPng returns false for an unknown id', () => {
    const sheet = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) };
    expect(upgradeSheetFromPng('does-not-exist', sheet)).toBe(false);
  });

  test('upgradeSheetFromPng swaps generate() to the loaded bytes', () => {
    const spec = spriteSheetById('flame')!;
    const original = { generate: spec.generate, frameW: spec.frameW, frameH: spec.frameH };
    const data = new Uint8ClampedArray(8 * 4 * 4).fill(7);
    try {
      expect(upgradeSheetFromPng('flame', { width: 8, height: 4, data })).toBe(true);
      // The upgraded sheet returns the loaded bytes deterministically.
      expect(spec.generate().data).toBe(data);
      expect(spec.generate().data).toBe(data);
      // frameW/frameH re-derive so the declared dims keep matching the bytes.
      expect(spec.frameW).toBe(8 / spec.cols);
      expect(spec.frameH).toBe(4 / spec.rows);
      expect(spec.cols * spec.frameW).toBe(8);
      expect(spec.rows * spec.frameH).toBe(4);
    } finally {
      // Restore the procedural fallback so later tests see the registry at rest.
      const mutable = spec as { -readonly [K in keyof SpriteSheetSpec]: SpriteSheetSpec[K] };
      mutable.generate = original.generate;
      mutable.frameW = original.frameW;
      mutable.frameH = original.frameH;
    }
    const restored = spec.generate();
    expect(restored.width).toBe(spec.cols * spec.frameW);
    expect(restored.height).toBe(spec.rows * spec.frameH);
    expect(restored.data.length).toBe(restored.width * restored.height * 4);
  });
});

describe('noise primitives', () => {
  test('mulberry32 is deterministic and stays in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const c = mulberry32(43);
    expect(c()).not.toBe(mulberry32(42)());
  });

  test('fbm2 mids stay levelled (mean ≈ 0.5, no biased distortion input)', () => {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        sum += fbm2(x * 0.37, y * 0.37, 4, 7331);
        n++;
      }
    }
    const mean = sum / n;
    expect(mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(0.65);
  });

  test('valueNoise2Tileable wraps seamlessly at the period', () => {
    for (const y of [0, 1.7, 3.2, 7.9]) {
      expect(valueNoise2Tileable(-0.01, y, 8, 5)).toBeCloseTo(valueNoise2Tileable(7.99, y, 8, 5), 10);
      expect(valueNoise2Tileable(8.01, y, 8, 5)).toBeCloseTo(valueNoise2Tileable(0.01, y, 8, 5), 10);
    }
  });

  test('noise sheet is tileable — seam pixels stay continuous', () => {
    const spec = spriteSheetById('noise');
    expect(spec).toBeDefined();
    const { width, height, data } = spec!.generate();
    const at = (x: number, y: number): number => data[(y * width + x) * 4]!;
    // Edge pixels are one step apart across the wrap — differences must be of
    // the same magnitude as interior one-step differences, never a hard seam.
    for (let y = 0; y < height; y += 13) {
      expect(Math.abs(at(0, y) - at(width - 1, y))).toBeLessThanOrEqual(48);
    }
    for (let x = 0; x < width; x += 13) {
      expect(Math.abs(at(x, 0) - at(x, height - 1))).toBeLessThanOrEqual(48);
    }
  });
});
