// merge-gen3d-motions.ts — merge a wb-gen3d character's per-motion GLBs into a
// single multi-clip GLB that matches hellforge's 5-clip contract.
//
//   bun scripts/merge-gen3d-motions.ts <gen3d-meta.json> <output.glb>
//
// gen3d (Meshy) ships a character as: <base>.rigged_model.glb (mesh + skeleton,
// no useful clip) + N × <base>.animated_model.motion-meshy-<id>.glb (each carries
// a FULL mesh copy + one clip ≈ 8k faces × N). Loading/switching N GLBs is slow.
// This script merges the clips into the rigged base (mesh kept once) and renames
// each clip to its contract slot (idle/move/attack/hit/death), producing one GLB
// the engine imports as mesh + skeleton + 5 animation-clip sub-assets.
//
// Run AFTER you've generated the character + motions. Then:
//   forgeax-engine-remote-gltf import <output.glb>   # → <output.glb>.meta.json
//   # copy the scene + 5 clip GUIDs into main.ts WITCH/HERO block
//
// ── deps (not in hellforge by default; install in the package you run this from) ──
//   bun add -d @gltf-transform/core @gltf-transform/functions
// (The monorepo already has @gltf-transform/core via wb-ai-asset; functions is
//  new. Both are dev-only, no runtime impact on the game.)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { mergeDocuments } from '@gltf-transform/functions';

// ── Motion label → contract slot mapping (EDIT THIS) ───────────────────────
// For each slot, an ordered list of keyword regexes. The first motion whose
// motionRef.label matches any keyword is used for that slot. Unmapped motions
// are listed at the end so you can refine. Missing slots are warned.
const MOTION_MAP: Record<string, RegExp[]> = {
  idle:   [/idle|stand|breath|待机|呼吸/i],
  move:   [/run|跑|dash|冲刺/i, /walk|走|move/i],          // prefer run, then walk
  attack: [/punch|kick|shot|combo|attack|slash|cast|挥|踢|打|施法/i],
  hit:    [/hit|hurt|damage|stagger|受击|被打|后仰/i],
  death:  [/dead|death|die|死亡|倒地|倒下/i],
};

const SLOTS = Object.keys(MOTION_MAP);

interface Gen3dDep {
  path: string;
  kind: string;
  motionRef?: { system: string; id: number; label: string };
}
interface Gen3dMeta {
  dependencies: Gen3dDep[];
}

function pickMotions(meta: Gen3dMeta, metaPath: string): {
  baseGlb: string;
  chosen: Record<string, { path: string; label: string }>;
  unmapped: { path: string; label: string }[];
  missing: string[];
} {
  const dir = dirname(metaPath);
  const rigged = meta.dependencies.find((d) => d.kind === 'rigged_model' && d.path.endsWith('.glb'));
  if (!rigged) throw new Error('gen3d-meta: no rigged_model .glb dependency');
  const baseGlb = join(dir, rigged.path);

  const motions = meta.dependencies.filter(
    (d) => d.kind === 'animated_model' && d.path.endsWith('.glb') && d.motionRef,
  ).map((d) => ({ path: join(dir, d.path), label: d.motionRef!.label }));

  const chosen: Record<string, { path: string; label: string }> = {};
  const used = new Set<number>();
  for (const slot of SLOTS) {
    // Iterate regexes in priority order (run before walk), then motions in dep
    // order — so a higher-priority keyword wins even if a lower one appears first.
    for (const re of MOTION_MAP[slot]) {
      for (let i = 0; i < motions.length; i++) {
        if (used.has(i)) continue;
        if (re.test(motions[i].label)) {
          chosen[slot] = motions[i];
          used.add(i);
          break;
        }
      }
      if (chosen[slot]) break;
    }
  }
  const unmapped = motions.filter((_, i) => !used.has(i));
  const missing = SLOTS.filter((s) => !chosen[s]);
  return { baseGlb, chosen, unmapped, missing };
}

async function main(): Promise<void> {
  const [metaArg, outArg] = process.argv.slice(2) as [string | undefined, string | undefined];
  if (!metaArg || !outArg) {
    console.error('usage: bun scripts/merge-gen3d-motions.ts <gen3d-meta.json> <output.glb>');
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(metaArg, 'utf8')) as Gen3dMeta;
  const { baseGlb, chosen, unmapped, missing } = pickMotions(meta, metaArg);

  console.log('base (rigged):', baseGlb);
  console.log('chosen motions:');
  for (const slot of SLOTS) {
    const c = chosen[slot];
    console.log(`  ${slot.padEnd(7)} ${c ? `← ${c.label}  (${c.path})` : '— MISSING —'}`);
  }
  if (unmapped.length) {
    console.log('unmapped motions (not used; edit MOTION_MAP if you want them):');
    for (const m of unmapped) console.log(`    ${m.label}  (${m.path})`);
  }
  if (missing.length) {
    console.warn(`\n⚠ missing slots: ${missing.join(', ')} — generate those motions and re-run.`);
  }

  const io = new NodeIO();
  const base = io.read(baseGlb);

  // Drop the rigged base's bind-pose/rest clip (useless T-pose, not a real motion).
  for (const anim of base.getRoot().listAnimations()) anim.dispose();

  // Merge each chosen motion; rename its single clip to the contract slot.
  for (const slot of SLOTS) {
    const c = chosen[slot];
    if (!c) continue;
    const motion = io.read(c.path);
    const clips = motion.getRoot().listAnimations();
    if (clips.length === 0) {
      console.warn(`  ⚠ ${slot}: ${c.label} has no animation clip — skipped`);
      continue;
    }
    if (clips.length > 1) {
      console.warn(`  ⚠ ${slot}: ${c.label} has ${clips.length} clips — using the first`);
    }
    clips[0].setName(slot);
    // Keep only the clip + skin/skeleton refs; drop the motion's duplicate mesh.
    mergeDocuments(base, motion);
    console.log(`  ✓ merged ${slot} ← ${c.label}`);
  }

  io.write(outArg, base);
  console.log(`\nwritten: ${outArg}  (${SLOTS.filter((s) => chosen[s]).length} clips)`);

  console.log('\nnext:');
  console.log(`  forgeax-engine-remote-gltf import ${outArg}`);
  console.log(`  # → ${outArg}.meta.json  (mesh/material/scene/texture/skeleton/skin + N animation-clip)`);
  console.log('  # copy the scene + clip GUIDs into main.ts WITCH/HERO block — see CHARACTER-ANIMATION-CONTRACT.md');
}

main().catch((e) => { console.error(e); process.exit(1); });
