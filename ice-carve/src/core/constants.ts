/** World-space X of the fixed guillotine blade plane. */
export const BLADE_WORLD_X = 0.72;

/** Voxel grid dimensions (cube). Macro grid; each cell holds 2³ sub-voxels. */
export const GRID_SIZE = 32;

/** Meters per macro voxel cell (~0.77 m block at 32³). */
export const CELL_SIZE = 0.024;

/** Sub-cells per macro voxel axis (2³ = 8 micro-cells per macro cell). */
export const SUB_VOXELS_PER_AXIS = 2;

/** Workpiece rest center on the carve table. */
export const WORKPIECE_CENTER = { x: 0, y: 0.42, z: 0 } as const;

/** Large mother-ice block (chisel source, Stage B). */
export const MOTHER_ICE_CENTER = { x: -2.15, y: 0.62, z: -0.35 } as const;
export const MOTHER_GRID_SIZE = 36;
export const MOTHER_CELL_SIZE = 0.022;

/** Infrared cut-plane visual (world X = BLADE_WORLD_X). */
export const CUT_PLANE_Y0 = 0.12;
export const CUT_PLANE_Y1 = 1.15;
export const CUT_PLANE_Z0 = -0.75;
export const CUT_PLANE_Z1 = 0.75;

/** Workpiece drag-rotate speeds (rad per pixel). */
export const ICE_ROT_X_SENS = 0.004;
export const ICE_ROT_Y_SENS = 0.005;

/** Free camera —斜向下俯视操作台. */
export const CAM_POS_X = 0.15;
export const CAM_POS_Y = 2.45;
export const CAM_POS_Z = 2.85;
export const CAM_YAW = 0.08;
export const CAM_PITCH = -0.52;
export const CAM_MOVE_SPEED = 2.4;
export const CAM_MIN_Y = 0.35;
export const CAM_MAX_Y = 6.5;

/** Arrow keys adjust simulation time scale (0 = pause, 1 = normal). */
export const TIME_SCALE_MIN = 0;
export const TIME_SCALE_MAX = 3;
export const TIME_SCALE_SPEED = 1.1;

/** Guillotine blade animation. */
export const BLADE_Y_TOP = 1.35;
export const BLADE_Y_BOTTOM = 0.55;
export const BLADE_DROP_SEC = 0.35;
export const BLADE_COOLDOWN = 0.55;
