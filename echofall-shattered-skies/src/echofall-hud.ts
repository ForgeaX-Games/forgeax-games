import type { BootstrapContext } from '@forgeax/engine-app';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { mountUi, type UiAsset } from '@forgeax/engine-ui';

const HUD_GUID = '0ed7f5f3-6b9b-4bbf-82f0-9b77a71b7110';

export type EchofallHudState = {
  shards: number;
  shardGoal: number;
  beacons: number;
  objective: string;
  interaction: string;
  message: string;
  region: string;
  checkpoint: string;
};

export type EchofallHud = { update(state: EchofallHudState): void; dispose(): void };
const empty: EchofallHud = { update() {}, dispose() {} };

export async function installEchofallHud(ctx?: BootstrapContext): Promise<EchofallHud> {
  if (!ctx?.assets || !ctx.uiRoot) return empty;
  const guid = AssetGuid.parse(HUD_GUID);
  if (!guid.ok) return empty;
  const loaded = await ctx.assets.loadByGuid<UiAsset>(guid.value);
  if (!loaded.ok) return empty;
  const mounted = mountUi(loaded.value, { root: ctx.uiRoot, layer: 80 });
  if (!mounted.ok) return empty;
  const shadow = mounted.value.host.shadowRoot;
  if (!shadow) return { update() {}, dispose: mounted.value.dispose };
  const slot = (name: string) => shadow.querySelector<HTMLElement>(`[data-ui-slot="${name}"]`);
  return {
    update(state) {
      const values: Record<string, string> = {
        shards: `${Math.min(state.shards, state.shardGoal)} / ${state.shardGoal}`,
        shardGoal: state.beacons === 0 ? 'SHARDS TO DAWN' : state.beacons === 1 ? 'SHARDS TO GALE' : 'SHARDS TO AETHER',
        beacons: `${state.beacons} / 3`, objective: state.objective,
        interaction: state.interaction, message: state.message, region: state.region,
        checkpoint: state.checkpoint,
      };
      for (const [name, value] of Object.entries(values)) {
        const element = slot(name);
        if (element && element.textContent !== value) element.textContent = value;
      }
    },
    dispose: mounted.value.dispose,
  };
}
