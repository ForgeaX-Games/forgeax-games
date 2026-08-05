// Projection-aware zoom shared by the template's perspective camera modes.

export const PERSPECTIVE_FOV_INITIAL = Math.PI / 3;
export const PERSPECTIVE_FOV_MIN = Math.PI / 5;
export const PERSPECTIVE_FOV_MAX = Math.PI - 0.2;
export const PERSPECTIVE_ZOOM_SPEED = 0.05;

export function zoomPerspectiveFov(fov: number, wheelDelta: number): number {
  return Math.max(
    PERSPECTIVE_FOV_MIN,
    Math.min(PERSPECTIVE_FOV_MAX, fov + wheelDelta * PERSPECTIVE_ZOOM_SPEED),
  );
}
