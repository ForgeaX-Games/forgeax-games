#!/usr/bin/env bun
/**
 * Blocker-vs-prop consistency validator (PR1 / L2).
 *
 * Camp (hard gate): compare `rogue-encampment.obstacles.json` AABB blockers to
 * visual pack entity footprints (unit-cube × Transform; mesh bounds absent in
 * meta).
 *
 * Wild (layout-internal only by design for PR1): `ashen-reach.layout.json` has
 * no companion scene pack — only layout-internal checks (blocker well-formedness,
 * route clear of blockers, landmarks near decor markers). Camp remains the
 * blocker-vs-visual hard gate; do not invent wild prop AABBs for scatter pools.
 *
 * Usage:
 *   bun hellforge/scripts/validate-blocker-prop-consistency.ts
 *   bun hellforge/scripts/validate-blocker-prop-consistency.ts --allowlist path.json
 *
 * Exit 1 on hard failures not covered by the allowlist.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TOLERANCE,
  compareCampBlockersToProps,
  isAllowlisted,
  validateWildLayoutInternal,
  type AllowlistEntry,
  type PackEntityTransform,
  type WildLayoutDoc,
} from '../src/blocker-prop-consistency.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELLFORGE_ROOT = resolve(HERE, '..');
const SCENES = join(HELLFORGE_ROOT, 'assets/scenes');

const DEFAULT_CAMP_PACK = join(SCENES, 'rogue-encampment.pack.json');
const DEFAULT_CAMP_OBSTACLES = join(SCENES, 'rogue-encampment.obstacles.json');
const DEFAULT_WILD_LAYOUT = join(SCENES, 'ashen-reach.layout.json');
const DEFAULT_ALLOWLIST = join(SCENES, 'blocker-prop-allowlist.json');

type SceneEntity = {
  localId?: number;
  components?: {
    Name?: { value?: string };
    Transform?: {
      pos?: number[];
      quat?: number[];
      scale?: number[];
    };
  };
};

function fail(msg: string): never {
  console.error(`[validate-blocker-prop] FAIL: ${msg}`);
  process.exit(1);
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  return argv[i + 1];
}

function loadAllowlist(path: string): AllowlistEntry[] {
  if (!existsSync(path)) return [];
  const doc = JSON.parse(readFileSync(path, 'utf8')) as {
    entries?: AllowlistEntry[];
  };
  return Array.isArray(doc.entries) ? doc.entries : [];
}

function loadCampEntities(packPath: string): PackEntityTransform[] {
  const pack = JSON.parse(readFileSync(packPath, 'utf8')) as {
    assets?: Array<{
      kind?: string;
      payload?: { entities?: SceneEntity[] };
    }>;
  };
  const scene = pack.assets?.find((a) => a.kind === 'scene');
  const entities = scene?.payload?.entities;
  if (!entities?.length) fail(`no scene entities in ${packPath}`);
  const out: PackEntityTransform[] = [];
  for (const e of entities) {
    const name = e.components?.Name?.value;
    const t = e.components?.Transform;
    if (!name || !t?.pos || !t.quat || !t.scale) continue;
    if (t.pos.length < 3 || t.quat.length < 4 || t.scale.length < 3) continue;
    out.push({
      name,
      pos: [t.pos[0]!, t.pos[1]!, t.pos[2]!],
      quat: [t.quat[0]!, t.quat[1]!, t.quat[2]!, t.quat[3]!],
      scale: [t.scale[0]!, t.scale[1]!, t.scale[2]!],
    });
  }
  return out;
}

function main(): void {
  const argv = process.argv.slice(2);
  const packPath = resolve(argValue(argv, '--pack') ?? DEFAULT_CAMP_PACK);
  const obstaclesPath = resolve(argValue(argv, '--obstacles') ?? DEFAULT_CAMP_OBSTACLES);
  const layoutPath = resolve(argValue(argv, '--layout') ?? DEFAULT_WILD_LAYOUT);
  const allowlistPath = resolve(argValue(argv, '--allowlist') ?? DEFAULT_ALLOWLIST);

  if (!existsSync(packPath)) fail(`camp pack not found: ${packPath}`);
  if (!existsSync(obstaclesPath)) fail(`camp obstacles not found: ${obstaclesPath}`);
  if (!existsSync(layoutPath)) fail(`wild layout not found: ${layoutPath}`);

  const allowlist = loadAllowlist(allowlistPath);
  const tol = DEFAULT_TOLERANCE;
  console.log(
    `[validate-blocker-prop] tolerance: center≤${tol.maxCenterDelta}m extent≤${tol.maxExtentDelta}m`,
  );
  console.log(
    `[validate-blocker-prop] wild stance: layout-internal only (no ashen-reach.pack.json)`,
  );

  const hard: string[] = [];
  const allowed: string[] = [];

  // --- Camp ---
  const obstacles = JSON.parse(readFileSync(obstaclesPath, 'utf8')) as {
    blockers?: Array<{
      type: string;
      label?: string;
      min?: [number, number];
      max?: [number, number];
    }>;
  };
  const entities = loadCampEntities(packPath);
  const campResults = compareCampBlockersToProps(
    obstacles.blockers ?? [],
    entities,
    tol,
  );
  let campOk = 0;
  for (const r of campResults) {
    if (r.ok) {
      campOk++;
      const c = r.compare!;
      console.log(
        `[validate-blocker-prop] camp OK ${r.label} (props=${r.propCount}`
          + ` centerΔ=${c.centerDelta.toFixed(3)}`
          + ` extΔ=${c.extentDeltaX.toFixed(3)}/${c.extentDeltaZ.toFixed(3)})`,
      );
      continue;
    }
    const detail = r.missingProps
      ? 'no matching pack props'
      : (r.compare?.reasons.join('; ') ?? 'divergence');
    const msg = `camp ${r.label}: ${detail}`;
    const entry = isAllowlisted(allowlist, 'camp', r.label);
    if (entry) {
      allowed.push(`${msg} [allowlisted: ${entry.reason}]`);
      console.warn(`[validate-blocker-prop] ALLOW ${msg} — ${entry.reason}`);
    } else {
      hard.push(msg);
      console.error(`[validate-blocker-prop] FAIL ${msg}`);
    }
  }

  // --- Wild ---
  const layout = JSON.parse(readFileSync(layoutPath, 'utf8')) as WildLayoutDoc;
  const wildViolations = validateWildLayoutInternal(layout);
  for (const v of wildViolations) {
    // Allowlist key = first token after "wild " that looks like a label/id
    const labelMatch = /wild (?:blocker|route|landmark) (\S+)/.exec(v);
    const label = labelMatch?.[1]?.replace(/:$/, '') ?? v;
    const entry = isAllowlisted(allowlist, 'wild', label);
    if (entry) {
      allowed.push(`${v} [allowlisted: ${entry.reason}]`);
      console.warn(`[validate-blocker-prop] ALLOW ${v} — ${entry.reason}`);
    } else {
      hard.push(v);
      console.error(`[validate-blocker-prop] FAIL ${v}`);
    }
  }
  if (wildViolations.length === 0) {
    console.log(
      `[validate-blocker-prop] wild OK: ${layout.blockers?.length ?? 0} blockers,`
        + ` ${(layout.route ?? []).length} route pts,`
        + ` ${(layout.landmarks ?? []).length} landmarks`,
    );
  }

  console.log(
    `[validate-blocker-prop] summary: camp ${campOk}/${campResults.length} pairs OK;`
      + ` wild violations ${wildViolations.length};`
      + ` allowlisted ${allowed.length}; hard ${hard.length}`,
  );

  if (hard.length > 0) {
    fail(`${hard.length} hard failure(s):\n  - ${hard.join('\n  - ')}`);
  }
  console.log('[validate-blocker-prop] OK');
}

main();
