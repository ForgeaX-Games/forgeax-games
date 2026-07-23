#!/usr/bin/env bun
// Generate Hellforge antechamber kit modules through wb-ai-asset's MeshyProvider
// (LiteLLM 3D gateway), then ingest + rebake.
//
// Requires Studio worktree .env:
//   AIASSET_ENABLE_REAL_PROVIDERS=1
//   ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL (or FORGEAX_3D_GATEWAY_*)
//
//   cd packages/games/hellforge
//   bun scripts/meshy-kit-via-wb-ai-asset.mts [--only kit-wall] [--skip-bake]
//
// Never invents job ids. Does not print secrets.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const studioRoot = resolve(gameRoot, '../../..');
const tmpDir = join(gameRoot, 'assets/kit/.meshy-tmp');
const pluginServer = resolve(
  studioRoot,
  'packages/marketplace/extensions/wb-ai-asset/server',
);

type KitId =
  | 'kit-floor'
  | 'kit-wall'
  | 'kit-corner'
  | 'kit-doorframe'
  | 'kit-pillar'
  | 'kit-trim'
  | 'kit-rubble';

const MODULES: Array<{ id: KitId; prompt: string }> = [
  {
    id: 'kit-floor',
    prompt:
      'dark fantasy hellforge dungeon floor tile, square 2 meter stone slab, cracked volcanic ash stone, scorched grooves, seamless tileable top face, low-poly game prop, opaque PBR, no characters',
  },
  {
    id: 'kit-wall',
    prompt:
      'dark fantasy hellforge dungeon wall segment, rectangular stone wall panel about 2m wide 3m tall, volcanic brick with slag veins, low-poly modular game prop, opaque PBR, no doors no characters',
  },
  {
    id: 'kit-corner',
    prompt:
      'dark fantasy hellforge dungeon L-shaped wall corner piece, modular stone corner for 2m grid, volcanic ash brick, low-poly game prop, opaque PBR, no characters',
  },
  {
    id: 'kit-doorframe',
    prompt:
      'dark fantasy hellforge stone doorframe portal arch, roughly 2.2m wide opening, carved slag stone lintel and pillars, modular dungeon prop, low-poly opaque PBR, empty opening, no door leaf, no characters',
  },
  {
    id: 'kit-pillar',
    prompt:
      'dark fantasy hellforge stone pillar column, about 0.5m thick 3.4m tall, cracked volcanic stone with metal bands, modular dungeon prop, low-poly opaque PBR, no characters',
  },
  {
    id: 'kit-trim',
    prompt:
      'dark fantasy hellforge stone cornice trim ledge, long horizontal molding for 2m wall top, volcanic ash stone, modular dungeon prop, low-poly opaque PBR, no characters',
  },
  {
    id: 'kit-rubble',
    prompt:
      'dark fantasy hellforge stone rubble pile debris, low mound of broken volcanic bricks and slag, modular dungeon prop, low-poly opaque PBR, no characters',
  },
];

function loadDotenv(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    if (key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv: string[]): { only: Set<string> | null; skipBake: boolean } {
  let only: Set<string> | null = null;
  let skipBake = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') {
      only = new Set((argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--skip-bake') skipBake = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: bun scripts/meshy-kit-via-wb-ai-asset.mts [--only kit-wall,kit-floor] [--skip-bake]');
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return { only, skipBake };
}

async function main(): Promise<void> {
  loadDotenv(join(studioRoot, '.env'));
  process.env.AIASSET_ENABLE_REAL_PROVIDERS = '1';

  const { getMeshyEnv } = await import(`${pluginServer}/env.ts`);
  const { MeshyProvider } = await import(`${pluginServer}/providers/meshy.ts`);

  const env = getMeshyEnv();
  if (!env) {
    throw new Error(
      'wb-ai-asset Meshy env unavailable. Need AIASSET_ENABLE_REAL_PROVIDERS=1 and a 3D gateway key (ANTHROPIC_API_KEY / FORGEAX_3D_GATEWAY_KEY).',
    );
  }
  console.log(`[meshy-kit] gateway base configured (len=${env.baseUrl.length}), poly=${env.defaultPolycount}`);

  const { only, skipBake } = parseArgs(process.argv.slice(2));
  mkdirSync(tmpDir, { recursive: true });

  const provider = new MeshyProvider({ env, slug: 'hellforge-pr1-kit' });
  const selected = MODULES.filter((m) => !only || only.has(m.id));
  if (selected.length === 0) throw new Error('no modules selected');

  for (const mod of selected) {
    console.log(`[meshy-kit] generating ${mod.id} …`);
    const result = await provider.generate({
      mode: 'text',
      prompt: mod.prompt,
      enablePbr: true,
      shouldTexture: true,
      modelType: 'lowpoly',
      targetPolycount: env.defaultPolycount,
      aiModel: 'meshy-6',
    });
    const glb = result.files.find((f) => f.role === 'source_mesh' && f.format === 'glb');
    if (!glb) throw new Error(`${mod.id}: no glb in provider result (job=${result.sourceJobId})`);
    const outPath = join(tmpDir, `${mod.id}.glb`);
    writeFileSync(outPath, glb.data);
    console.log(`[meshy-kit] ${mod.id} job=${result.sourceJobId} → ${outPath} (${glb.data.byteLength} bytes)`);

    const ingest = spawnSync(
      'bun',
      [
        'scripts/ingest-kit-module.ts',
        '--id', mod.id,
        '--file', outPath,
        '--job-id', String(result.sourceJobId),
        '--prompt', mod.prompt,
        '--provider', 'meshy',
      ],
      { cwd: gameRoot, stdio: 'inherit' },
    );
    if ((ingest.status ?? 1) !== 0) {
      throw new Error(`ingest failed for ${mod.id}`);
    }

    // Respect rate limit (~3/min) between modules.
    if (mod !== selected[selected.length - 1]) {
      const waitMs = Math.ceil(60_000 / Math.max(1, env.rateLimitPerMin)) + 500;
      console.log(`[meshy-kit] rate-limit pause ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  if (!skipBake) {
    console.log('[meshy-kit] rebaking antechamber + validators…');
    for (const cmd of [
      ['scripts/bake-antechamber.ts'],
      ['scripts/validate-kit.ts'],
      ['scripts/report-kit-texel-density.ts'],
      ['scripts/validate-scene-pack.ts', 'assets/scenes/boss-antechamber.pack.json', '--allow-missing-veyra'],
    ]) {
      const r = spawnSync('bun', cmd, { cwd: gameRoot, stdio: 'inherit' });
      if ((r.status ?? 1) !== 0) throw new Error(`failed: bun ${cmd.join(' ')}`);
    }
  }

  console.log('[meshy-kit] DONE');
}

main().catch((err) => {
  console.error('[meshy-kit] FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
