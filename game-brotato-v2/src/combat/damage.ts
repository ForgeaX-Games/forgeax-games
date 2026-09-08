export interface DamageResult {
  readonly current: number;
  readonly applied: number;
  readonly killed: boolean;
}
export function applyDamage(current: number, amount: number): DamageResult {
  const safeCurrent = Math.max(0, current);
  const safeAmount = Math.max(0, amount);
  const next = Math.max(0, safeCurrent - safeAmount);
  return { current: next, applied: safeCurrent - next, killed: next <= 0 };
}
