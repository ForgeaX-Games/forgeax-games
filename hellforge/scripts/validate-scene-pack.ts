#!/usr/bin/env bun
// Deterministic scene-pack validator for Hellforge camp (Task 4.4).
// Fails on non-contiguous/duplicate localId, missing/duplicate NpcVeyraAnchor,
// out-of-range ref indices, or absent Veyra scene/idle GUID metadata.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const VEYRA_ANCHOR = 'NpcVeyraAnchor';
const VEYRA_SCENE_GUID = '5e3028dd-ddf6-4104-86d9-318d3e8fb5a6';
const VEYRA_IDLE_GUID = 'c530adf2-8de6-486a-afaa-9af3a6e6dfd1';
const WITCH_META = 'assets/characters/witch.glb.meta.json';

type Entity = {
  localId: number;
  components?: {
    Name?: { value?: string };
    MeshFilter?: { assetHandle?: number };
    MeshRenderer?: { materials?: number[] };
  };
};

type SceneAsset = {
  kind: string;
  refs?: string[];
  payload?: { entities?: Entity[] };
};

function fail(msg: string): never {
  console.error(`[validate-scene-pack] FAIL: ${msg}`);
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const allowMissingVeyra = args.includes('--allow-missing-veyra');
  const packArg = args.find((a) => !a.startsWith('--'));
  if (!packArg) {
    fail('usage: bun scripts/validate-scene-pack.ts <pack.json> [--allow-missing-veyra]');
  }
  const packPath = resolve(packArg);
  if (!existsSync(packPath)) fail(`pack not found: ${packPath}`);

  const pack = JSON.parse(readFileSync(packPath, 'utf8')) as {
    assets?: SceneAsset[];
  };
  const scene = pack.assets?.find((a) => a.kind === 'scene');
  if (!scene?.payload?.entities) fail('no scene asset with entities');

  const entities = scene.payload.entities;
  const refs = scene.refs ?? [];
  const ids = entities.map((e) => e.localId);

  // Contiguous 0..n-1, no duplicates
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) fail(`duplicate localId ${id}`);
    seen.add(id);
  }
  for (let i = 0; i < entities.length; i++) {
    if (!seen.has(i)) fail(`non-contiguous localId: missing ${i}`);
  }
  if (Math.max(...ids, -1) !== entities.length - 1) {
    fail(`localId max ${Math.max(...ids)} !== length-1 ${entities.length - 1}`);
  }

  // Ref index bounds
  for (const e of entities) {
    const mf = e.components?.MeshFilter?.assetHandle;
    if (typeof mf === 'number' && (mf < 0 || mf >= refs.length)) {
      fail(`entity ${e.localId} MeshFilter.assetHandle ${mf} out of range (refs=${refs.length})`);
    }
    const mats = e.components?.MeshRenderer?.materials;
    if (Array.isArray(mats)) {
      for (const h of mats) {
        if (typeof h === 'number' && (h < 0 || h >= refs.length)) {
          fail(`entity ${e.localId} material handle ${h} out of range`);
        }
      }
    }
  }

  // Camp packs require exactly one NpcVeyraAnchor. Non-camp packs (boss
  // antechamber) may pass --allow-missing-veyra — do not weaken camp checks.
  const anchors = entities.filter((e) => e.components?.Name?.value === VEYRA_ANCHOR);
  if (!allowMissingVeyra) {
    if (anchors.length === 0) fail(`missing ${VEYRA_ANCHOR}`);
    if (anchors.length > 1) fail(`duplicate ${VEYRA_ANCHOR} (count=${anchors.length})`);

    // Veyra scene + idle GUIDs present in witch.glb.meta.json
    // pack lives at assets/scenes/… → hellforge root is ../..
    const hellforgeRoot = resolve(dirname(packPath), '../..');
    const witchMetaPath = join(hellforgeRoot, WITCH_META);
    if (!existsSync(witchMetaPath)) {
      fail(`witch meta missing at ${witchMetaPath}`);
    }
    const meta = JSON.parse(readFileSync(witchMetaPath, 'utf8')) as {
      subAssets?: Array<{ guid?: string; kind?: string }>;
    };
    const guids = new Set((meta.subAssets ?? []).map((s) => s.guid).filter(Boolean));
    if (!guids.has(VEYRA_SCENE_GUID)) {
      fail(`witch.glb.meta.json missing Veyra scene GUID ${VEYRA_SCENE_GUID}`);
    }
    if (!guids.has(VEYRA_IDLE_GUID)) {
      fail(`witch.glb.meta.json missing Veyra idle GUID ${VEYRA_IDLE_GUID}`);
    }
    const sceneSub = meta.subAssets?.find((s) => s.guid === VEYRA_SCENE_GUID);
    const idleSub = meta.subAssets?.find((s) => s.guid === VEYRA_IDLE_GUID);
    if (sceneSub?.kind !== 'scene') fail(`GUID ${VEYRA_SCENE_GUID} kind is not scene`);
    if (idleSub?.kind !== 'animation-clip') fail(`GUID ${VEYRA_IDLE_GUID} kind is not animation-clip`);

    console.log(`[validate-scene-pack] OK: ${entities.length} entities, ${VEYRA_ANCHOR} present, Veyra GUIDs verified`);
    return;
  }

  if (anchors.length > 1) fail(`duplicate ${VEYRA_ANCHOR} (count=${anchors.length})`);
  console.log(
    `[validate-scene-pack] OK: ${entities.length} entities `
    + `(--allow-missing-veyra; ${VEYRA_ANCHOR} ${anchors.length === 0 ? 'absent' : 'present'})`,
  );
}

main();
