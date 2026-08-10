import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import type { HudHandle } from './hud';
import type { WorldScoreTextHandle } from './world-score-text';

type ScorePopupArgs = {
  readonly world: World;
  readonly camera: EntityHandle;
  readonly canvas: HTMLCanvasElement;
  readonly hud: HudHandle;
  readonly worldScoreText: WorldScoreTextHandle | undefined;
};

/** Project hit feedback through the current camera into the HUD's local space. */
export function createScorePopup(args: ScorePopupArgs): (text: string, worldX: number, worldY: number, worldZ: number) => void {
  const fov = Math.PI / 3;
  return (text, worldX, worldY, worldZ): void => {
    const cameraTransform = args.world.get(args.camera, Transform);
    if (!cameraTransform.ok) return;
    const cameraX = cameraTransform.value.pos[0] ?? 0;
    const cameraY = cameraTransform.value.pos[1] ?? 0;
    const cameraZ = cameraTransform.value.pos[2] ?? 0;
    const qx = -(cameraTransform.value.quat[0] ?? 0);
    const qy = -(cameraTransform.value.quat[1] ?? 0);
    const qz = -(cameraTransform.value.quat[2] ?? 0);
    const qw = cameraTransform.value.quat[3] ?? 1;
    const dx = worldX - cameraX;
    const dy = worldY - cameraY;
    const dz = worldZ - cameraZ;
    const tx = 2 * (qy * dz - qz * dy);
    const ty = 2 * (qz * dx - qx * dz);
    const tz = 2 * (qx * dy - qy * dx);
    const localX = dx + qw * tx + (qy * tz - qz * ty);
    const localY = dy + qw * ty + (qz * tx - qx * tz);
    const localZ = dz + qw * tz + (qx * ty - qy * tx);
    if (localZ >= -0.05) return;
    const width = args.canvas.clientWidth;
    const height = args.canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    const focal = 1 / Math.tan(fov * 0.5);
    const ndcX = (localX * focal) / (-localZ * (width / height));
    const ndcY = (localY * focal) / -localZ;
    if (ndcX < -1.2 || ndcX > 1.2 || ndcY < -1.2 || ndcY > 1.2) return;
    args.hud.floatScore(text, (ndcX + 1) * 0.5 * width, (1 - ndcY) * 0.5 * height);
    args.worldScoreText?.show(text, [worldX, worldY + 0.9, worldZ]);
  };
}
