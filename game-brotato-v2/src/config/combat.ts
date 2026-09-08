export const COMBAT = {
  player: {
    maxHealth: 20,
    collisionRadius: 0.58,
    invulnerabilitySeconds: 0.6,
  },
  enemy: {
    maxHealth: 10,
    collisionRadius: 0.52,
    speed: 2.6,
    spawnRadius: 13.5,
    contactDamage: 1,
    collisionIterations: 32,
    attackCooldown: 1,
    hopFrequency: 2.6,
    hopHeight: 0.11,
    squashFactor: 0.35,
  },
  weapons: {
    ringRadius: 0.62,
    slots: [-Math.PI / 2, Math.PI / 2] as const,
    /** The weapon body, excluding its separate range footprint, is half a grid. */
    modelGridSize: 0.5,
    /** Render-only scale for the hand-held model; the attack footprint stays at logical size. */
    modelScale: 2,
  },
  attackRangeVisual: {
    idleScale: 0.035,
    activeScale: 1,
    strikeScale: 1.08,
  },
} as const;

export type CombatPhase = 'playing' | 'defeated';
