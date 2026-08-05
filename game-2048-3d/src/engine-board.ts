import { HANDLE_CUBE } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import type { Handle, MaterialAsset } from '@forgeax/engine-types';

type MaterialHandle = Handle<'MaterialAsset', 'shared'>;
type Vec3 = readonly [number, number, number];

interface RenderPart {
  readonly entity: EntityHandle;
  readonly fromPosition: Vec3;
  readonly toPosition: Vec3;
  readonly fromScale: Vec3;
  readonly toScale: Vec3;
}

interface TileGroup {
  readonly parts: readonly RenderPart[];
  readonly merged: boolean;
  readonly removeAfter: boolean;
  elapsed: number;
  duration: number;
}

interface SourceTile {
  readonly index: number;
  readonly value: number;
  used: boolean;
}

const SEGMENTS: Readonly<Record<string, readonly string[]>> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
};

const TILE_COLORS: readonly (readonly [number, number, number])[] = [
  [0.36, 0.95, 0.89],
  [0.25, 0.78, 0.98],
  [0.34, 0.52, 1],
  [0.51, 0.38, 1],
  [0.72, 0.31, 0.98],
  [0.93, 0.28, 0.72],
  [1, 0.35, 0.48],
  [1, 0.52, 0.27],
  [1, 0.72, 0.2],
  [1, 0.9, 0.3],
] as const;

/**
 * The numbers and tiles are actual ECS entities rendered by ForgeaX. The DOM is
 * only a score/control HUD; no board cell or tile is represented by HTML.
 */
export class EngineBoard2048 {
  private readonly tileMaterials: readonly MaterialHandle[];
  private readonly digitMaterial: MaterialHandle;
  private groups: TileGroup[] = [];
  private lastGrid: readonly number[] | null = null;

  constructor(private readonly world: World) {
    this.tileMaterials = TILE_COLORS.map((color, tier) => this.material({
      baseColor: [color[0], color[1], color[2], 1],
      metallic: 0.18 + tier * 0.025,
      roughness: Math.max(0.16, 0.38 - tier * 0.018),
      emissive: [color[0] * 0.25, color[1] * 0.25, color[2] * 0.25],
      emissiveIntensity: 0.7 + tier * 0.1,
    }));
    this.digitMaterial = this.material({
      baseColor: [0.025, 0.02, 0.055, 1],
      metallic: 0.55,
      roughness: 0.18,
      emissive: [0.12, 0.08, 0.25],
      emissiveIntensity: 1.2,
    });
  }

  sync(grid: readonly number[], spawnedIndex: number | null, mergedIndices: readonly number[]): void {
    if (this.lastGrid && sameGrid(this.lastGrid, grid)) return;
    const previous = this.lastGrid;
    this.clearGroups();

    const sources: SourceTile[] = previous
      ? previous.flatMap((value, index) => value === 0 ? [] : [{ index, value, used: false }])
      : [];
    const merged = new Set(mergedIndices);

    for (let index = 0; index < grid.length; index += 1) {
      const value = grid[index] ?? 0;
      if (value === 0) continue;
      const isSpawned = index === spawnedIndex;
      const sourceValue = merged.has(index) ? value / 2 : value;
      const first = isSpawned ? undefined : nearestSource(sources, sourceValue, index);
      if (first) first.used = true;

      if (merged.has(index)) {
        const second = nearestSource(sources, sourceValue, index);
        if (second) {
          second.used = true;
          this.groups.push(this.spawnTile(sourceValue, second.index, index, false, true));
        }
      }
      this.groups.push(this.spawnTile(value, first?.index ?? index, index, merged.has(index), false, isSpawned));
    }
    this.lastGrid = [...grid];
  }

  tick(deltaSeconds: number): void {
    const survivors: TileGroup[] = [];
    for (const group of this.groups) {
      group.elapsed = Math.min(group.duration, group.elapsed + Math.max(0, deltaSeconds));
      const linear = group.duration === 0 ? 1 : group.elapsed / group.duration;
      const eased = 1 - Math.pow(1 - linear, 3);
      const pulse = group.merged ? 1 + Math.sin(linear * Math.PI) * 0.18 : 1;

      for (const part of group.parts) {
        const scale = lerp3(part.fromScale, part.toScale, eased);
        this.world.set(part.entity, Transform, {
          pos: lerp3(part.fromPosition, part.toPosition, eased),
          scale: [scale[0] * pulse, scale[1] * pulse, scale[2] * pulse],
        });
      }

      if (linear >= 1 && group.removeAfter) {
        for (const part of group.parts) this.world.despawn(part.entity);
      } else {
        survivors.push(group);
      }
    }
    this.groups = survivors;
  }

  dispose(): void {
    this.clearGroups();
    this.lastGrid = null;
  }

  private spawnTile(
    value: number,
    fromIndex: number,
    toIndex: number,
    merged: boolean,
    removeAfter: boolean,
    spawned = false,
  ): TileGroup {
    const fromCell = cellPosition(fromIndex);
    const toCell = cellPosition(toIndex);
    const tileScale: Vec3 = [0.88, 0.38, 0.88];
    const startScale: Vec3 = spawned ? [0.08, 0.04, 0.08] : tileScale;
    const parts: RenderPart[] = [];
    const material = this.tileMaterials[Math.min(
      this.tileMaterials.length - 1,
      Math.max(0, Math.log2(value) - 1),
    )]!;

    parts.push(this.spawnPart(
      [fromCell[0], spawned ? 0.48 : 0.69, fromCell[2]],
      [toCell[0], 0.69, toCell[2]],
      startScale,
      removeAfter ? [0.04, 0.04, 0.04] : tileScale,
      material,
    ));

    for (const digit of digitGeometry(value)) {
      parts.push(this.spawnPart(
        [fromCell[0] + digit.position[0], spawned ? 0.72 : 0.925, fromCell[2] + digit.position[2]],
        [toCell[0] + digit.position[0], 0.925, toCell[2] + digit.position[2]],
        spawned ? [0.01, 0.01, 0.01] : digit.scale,
        removeAfter ? [0.01, 0.01, 0.01] : digit.scale,
        this.digitMaterial,
      ));
    }

    return {
      parts,
      merged,
      removeAfter,
      elapsed: 0,
      duration: spawned ? 0.24 : merged ? 0.22 : 0.16,
    };
  }

  private spawnPart(
    fromPosition: Vec3,
    toPosition: Vec3,
    fromScale: Vec3,
    toScale: Vec3,
    material: MaterialHandle,
  ): RenderPart {
    const entity = this.world.spawn(
      { component: Transform, data: { pos: [...fromPosition], scale: [...fromScale] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [material] } },
    ).unwrap();
    return { entity, fromPosition, toPosition, fromScale, toScale };
  }

  private material(options: Parameters<typeof Materials.standard>[0]): MaterialHandle {
    return this.world.allocSharedRef<'MaterialAsset', MaterialAsset>(
      'MaterialAsset',
      Materials.standard(options),
    );
  }

  private clearGroups(): void {
    for (const group of this.groups) {
      for (const part of group.parts) this.world.despawn(part.entity);
    }
    this.groups = [];
  }
}

interface DigitPart {
  readonly position: Vec3;
  readonly scale: Vec3;
}

function digitGeometry(value: number): DigitPart[] {
  const text = String(value);
  const scale = text.length <= 2 ? 1 : text.length === 3 ? 0.78 : text.length === 4 ? 0.64 : 0.52;
  const spacing = 0.25 * scale;
  const startX = -((text.length - 1) * spacing) / 2;
  const parts: DigitPart[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const centerX = startX + index * spacing;
    for (const segment of SEGMENTS[text[index]!] ?? []) {
      parts.push(segmentGeometry(segment, centerX, scale));
    }
  }
  return parts;
}

function segmentGeometry(segment: string, centerX: number, scale: number): DigitPart {
  const horizontal = segment === 'a' || segment === 'g' || segment === 'd';
  const xOffset = segment === 'f' || segment === 'e' ? -0.1 * scale
    : segment === 'b' || segment === 'c' ? 0.1 * scale
      : 0;
  const zOffset = segment === 'a' ? -0.19 * scale
    : segment === 'd' ? 0.19 * scale
      : segment === 'f' || segment === 'b' ? -0.095 * scale
        : segment === 'e' || segment === 'c' ? 0.095 * scale
          : 0;
  return {
    position: [centerX + xOffset, 0, zOffset],
    scale: horizontal ? [0.19 * scale, 0.045, 0.055 * scale] : [0.055 * scale, 0.045, 0.15 * scale],
  };
}

function cellPosition(index: number): Vec3 {
  const row = Math.floor(index / 4);
  const column = index % 4;
  return [(column - 1.5) * 1.1, 0, (row - 1.5) * 1.1];
}

function nearestSource(sources: readonly SourceTile[], value: number, targetIndex: number): SourceTile | undefined {
  return sources
    .filter((source) => !source.used && source.value === value)
    .sort((a, b) => distance(a.index, targetIndex) - distance(b.index, targetIndex))[0];
}

function distance(from: number, to: number): number {
  return Math.abs(Math.floor(from / 4) - Math.floor(to / 4))
    + Math.abs((from % 4) - (to % 4));
}

function sameGrid(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function lerp3(from: Vec3, to: Vec3, amount: number): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}
