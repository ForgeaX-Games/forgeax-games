// check-skeleton-compat.ts — zero-dep skeleton diff between two GLBs.
//
//   bun scripts/check-skeleton-compat.ts <witch.glb> <meshy-rigged-or-motion.glb>
//
// merge-gen3d-motions.ts merges per-motion GLBs into the rigged base assuming
// identical skeletons. This script checks that assumption by comparing the
// skin.joints node-name sets of two GLBs, so you know up front whether the
// merged clips will bind to the same skeleton as witch (drop-in replace) or
// whether the meshy character uses a different rig and needs retargeting.
//
// Zero deps (only node:fs): reads the GLB JSON chunk directly. Run from
// hellforge root with bun.

import { readFileSync } from 'node:fs';

interface GltfNode { name?: string; children?: number[]; mesh?: number; skin?: number; }
interface GltfSkin { joints: number[]; skeleton?: number; inverseBindMatrices?: number; }
interface Gltf { nodes?: GltfNode[]; skins?: GltfSkin[]; }

function readGltfJson(path: string): Gltf {
  const buf = readFileSync(path);
  if (buf.length < 20) throw new Error(`${path}: too short to be a GLB`);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB (bad magic)`);
  const chunkLen = buf.readUInt32LE(12);
  const chunkType = buf.readUInt32LE(16);
  if (chunkType !== 0x4e4f534a) throw new Error(`${path}: first chunk is not JSON`);
  const json = buf.subarray(20, 20 + chunkLen).toString('utf8');
  return JSON.parse(json) as Gltf;
}

interface SkelInfo {
  path: string;
  nodeCount: number;
  skinCount: number;
  jointCount: number;
  hasIBM: boolean;
  names: string[];      // joint node names, in skin.joints order
  chainRoots: string[]; // root ancestor name per joint (rig family signature)
}

function skelInfo(path: string): SkelInfo {
  const g = readGltfJson(path);
  const nodes = g.nodes ?? [];
  const skins = g.skins ?? [];
  const parent = new Map<number, number>();
  for (let i = 0; i < nodes.length; i++) {
    for (const c of nodes[i].children ?? []) parent.set(c, i);
  }
  if (skins.length === 0) {
    return { path, nodeCount: nodes.length, skinCount: 0, jointCount: 0, hasIBM: false, names: [], chainRoots: [] };
  }
  const skin = skins[0];
  const names = skin.joints.map((i) => nodes[i]?.name ?? `<node#${i}>`);
  const chainRoots = skin.joints.map((i) => {
    let cur: number | undefined = i;
    let root: number = i;
    while (cur !== undefined) { root = cur; cur = parent.get(cur); }
    return nodes[root]?.name ?? `<node#${root}>`;
  });
  return {
    path,
    nodeCount: nodes.length,
    skinCount: skins.length,
    jointCount: skin.joints.length,
    hasIBM: skin.inverseBindMatrices !== undefined,
    names,
    chainRoots,
  };
}

function main(): void {
  const [aArg, bArg] = process.argv.slice(2) as [string | undefined, string | undefined];
  if (!aArg || !bArg) {
    console.error('usage: bun scripts/check-skeleton-compat.ts <witch.glb> <meshy.glb>');
    process.exit(1);
  }
  const A = skelInfo(aArg);
  const B = skelInfo(bArg);

  console.log(`A (witch):  ${A.path}`);
  console.log(`  nodes=${A.nodeCount} skins=${A.skinCount} joints=${A.jointCount} IBM=${A.hasIBM}`);
  console.log(`B (meshy):  ${B.path}`);
  console.log(`  nodes=${B.nodeCount} skins=${B.skinCount} joints=${B.jointCount} IBM=${B.hasIBM}`);

  if (A.skinCount === 0 || B.skinCount === 0) {
    console.log('\nverdict: NO SKIN — one GLB has no skin; nothing to compare.');
    process.exit(2);
  }

  const setA = new Set(A.names);
  const setB = new Set(B.names);
  const common = [...setA].filter((n) => setB.has(n)).sort();
  const onlyA = [...setA].filter((n) => !setB.has(n)).sort();
  const onlyB = [...setB].filter((n) => !setA.has(n)).sort();
  const sameOrder = A.names.length === B.names.length && A.names.every((n, i) => n === B.names[i]);
  const sameRoots = A.chainRoots.length === B.chainRoots.length &&
    A.chainRoots.every((r, i) => r === B.chainRoots[i]);

  console.log(`\ncommon joints:  ${common.length}/${setA.size}`);
  if (onlyA.length) console.log(`only in witch:  ${onlyA.join(', ')}`);
  if (onlyB.length) console.log(`only in meshy:  ${onlyB.join(', ')}`);
  console.log(`same order:      ${sameOrder}`);
  console.log(`same rig root:   ${sameRoots}  (witch root=${A.chainRoots[0] ?? '-'}, meshy root=${B.chainRoots[0] ?? '-'})`);

  const compat = onlyA.length === 0 && onlyB.length === 0 && A.jointCount === B.jointCount;
  if (compat) {
    console.log('\nverdict: COMPATIBLE — merge-gen3d-motions can bind the motion clips onto the same skeleton as witch. Drop-in replace after merge + import.');
  } else if (common.length === 0) {
    console.log('\nverdict: INCOMPATIBLE — no joint names overlap. meshy uses a totally different rig; you need full retargeting (not just merge).');
  } else {
    console.log('\nverdict: PARTIAL — joints overlap but not identical. merge may bind the shared joints but the rest won\'t drive; expect broken deformation. Consider retargeting onto witch\'s mixamorig skeleton.');
  }
}

main();
