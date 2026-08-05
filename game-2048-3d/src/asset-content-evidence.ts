import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { Skylight } from '@forgeax/engine-render';
import type { Renderer } from '@forgeax/engine-render';
import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import type { EquirectAsset } from '@forgeax/engine-types';

export const GAME_DEFAULT_HDR_GUID = '81eec382-392f-5a93-8998-0ecf11ef7990';
const MISSING_GUID = '00000000-0000-4000-8000-000000000000';
export const GAME_DEFAULT_ASSET_EVIDENCE_KEY = '__forgeaxGameDefaultAssetEvidence';

type AssetLoadWitness = {
  readonly ok: boolean;
  readonly code?: string;
  readonly kind?: string;
  readonly width?: number;
  readonly height?: number;
  readonly format?: string;
  readonly colorSpace?: string;
};

export type GameDefaultAssetEvidence = {
  readonly ready: Promise<void>;
  readonly reload: () => Promise<AssetLoadWitness>;
  readonly setIntensity: (intensity: number) => void;
  readonly reset: () => void;
  readonly probeMissing: () => Promise<{ readonly ok: boolean; readonly code?: string }>;
  readonly snapshot: () => {
    readonly guid: string;
    readonly name: string;
    readonly load: AssetLoadWitness;
    readonly reloads: number;
    readonly intensity: number | null;
    readonly passNames: readonly string[];
  };
};

type AssetContentEvidenceArgs = {
  readonly assets: AssetRegistry | undefined;
  readonly renderer: Renderer | undefined;
  readonly world: World;
  readonly skylight: EntityHandle | undefined;
  readonly registerCleanup?: (cleanup: () => void) => void;
};

function witnessFromResult(result: Awaited<ReturnType<AssetRegistry['loadByGuid']>>): AssetLoadWitness {
  if (!result.ok) return { ok: false, code: result.error.code };
  const payload = result.value as EquirectAsset;
  return {
    ok: true,
    kind: payload.kind,
    width: payload.width,
    height: payload.height,
    format: payload.format,
    colorSpace: payload.colorSpace,
  };
}

function parseGuid(text: string): ReturnType<typeof AssetGuid.parse> {
  return AssetGuid.parse(text);
}

export function installAssetContentEvidence(args: AssetContentEvidenceArgs): void {
  if (args.assets === undefined || args.renderer === undefined || typeof location === 'undefined') return;
  if (!new URLSearchParams(location.search).has('asset-evidence')) return;

  const guidResult = parseGuid(GAME_DEFAULT_HDR_GUID);
  const missingResult = parseGuid(MISSING_GUID);
  if (!guidResult.ok || !missingResult.ok) return;
  const guid = guidResult.value;
  const missingGuid = missingResult.value;
  let latest: AssetLoadWitness = { ok: false, code: 'not-started' };
  let reloads = 0;

  const apply = (payload: EquirectAsset, intensity: number): void => {
    if (args.skylight === undefined) return;
    const equirect = args.world.allocSharedRef('EquirectAsset', payload);
    args.world.set(args.skylight, Skylight, { equirect, intensity });
  };

  const load = async (): Promise<AssetLoadWitness> => {
    const result = await args.assets!.loadByGuid<EquirectAsset>(guid);
    latest = witnessFromResult(result);
    if (result.ok) apply(result.value, 0.25);
    return latest;
  };

  const ready = load().then(() => undefined);
  const reload = async (): Promise<AssetLoadWitness> => {
    args.assets!.invalidate(GAME_DEFAULT_HDR_GUID);
    reloads += 1;
    return load();
  };
  const setIntensity = (intensity: number): void => {
    if (args.skylight === undefined) return;
    args.world.set(args.skylight, Skylight, { intensity });
  };
  const reset = (): void => setIntensity(0.25);
  const probeMissing = async (): Promise<{ readonly ok: boolean; readonly code?: string }> => {
    const result = await args.assets!.loadByGuid<EquirectAsset>(missingGuid);
    return result.ok ? { ok: true } : { ok: false, code: result.error.code };
  };
  const evidence: GameDefaultAssetEvidence = {
    ready,
    reload,
    setIntensity,
    reset,
    probeMissing,
    snapshot: () => {
      const skylight = args.skylight === undefined ? null : args.world.get(args.skylight, Skylight);
      return {
        guid: GAME_DEFAULT_HDR_GUID,
        name: args.assets!.resolveName(GAME_DEFAULT_HDR_GUID),
        load: latest,
        reloads,
        intensity: skylight?.ok ? skylight.value.intensity : null,
        passNames: [...args.renderer!.perFramePassNames],
      };
    },
  };
  const host = globalThis as unknown as Record<string, unknown>;
  host[GAME_DEFAULT_ASSET_EVIDENCE_KEY] = evidence;
  args.registerCleanup?.(() => {
    if (host[GAME_DEFAULT_ASSET_EVIDENCE_KEY] === evidence) delete host[GAME_DEFAULT_ASSET_EVIDENCE_KEY];
  });
}
