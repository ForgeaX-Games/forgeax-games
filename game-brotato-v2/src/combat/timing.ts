/** Advance one fixed-step timer without allowing it to become negative. */
export function tickCooldown(cooldown: number, dt: number): number {
  const current = Number.isFinite(cooldown) ? Math.max(0, cooldown) : 0;
  const delta = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  const remaining = current - delta;
  return remaining <= 1e-9 ? 0 : remaining;
}

/** A weapon may attack only after its cooldown has fully elapsed. */
export function isCooldownReady(cooldown: number): boolean {
  return Number.isFinite(cooldown) && cooldown <= 0;
}
