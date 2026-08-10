/**
 * The smallest lifecycle capability retained after an installer failed to
 * undo all of its World mutations. Calling dispose retries only the remaining
 * mutations; returning means the owner is complete and later calls are inert.
 */
export type ResidualCleanupOwner = {
  readonly label: string;
  readonly hasPending: () => boolean;
  readonly dispose: () => void;
};

/**
 * A typed installation failure whose rollback left observable World state.
 * The original failure and every rollback failure remain independently
 * inspectable while residualCleanup preserves the authority needed to retry.
 */
export class ResidualCleanupError extends AggregateError {
  readonly kind = "aetherfall-residual-cleanup" as const;
  readonly primary: unknown;
  readonly rollbackErrors: readonly unknown[];
  readonly residualCleanup: ResidualCleanupOwner;

  constructor(args: {
    readonly primary: unknown;
    readonly rollbackErrors: readonly unknown[];
    readonly residualCleanup: ResidualCleanupOwner;
    readonly message: string;
  }) {
    super([args.primary, ...args.rollbackErrors], args.message);
    this.name = "ResidualCleanupError";
    this.primary = args.primary;
    this.rollbackErrors = [...args.rollbackErrors];
    this.residualCleanup = args.residualCleanup;
  }
}

export function isResidualCleanupError(
  error: unknown,
): error is ResidualCleanupError {
  if (!(error instanceof AggregateError)) return false;
  const candidate = error as Partial<ResidualCleanupError>;
  return (
    candidate.kind === "aetherfall-residual-cleanup" &&
    isResidualCleanupOwner(candidate.residualCleanup)
  );
}

export function isResidualCleanupOwner(
  owner: unknown,
): owner is ResidualCleanupOwner {
  if (owner === null || typeof owner !== "object") return false;
  const candidate = owner as Partial<ResidualCleanupOwner>;
  return (
    typeof candidate.label === "string" &&
    typeof candidate.hasPending === "function" &&
    typeof candidate.dispose === "function"
  );
}

/**
 * Preserve rollback errors even when their throwing operation nevertheless
 * completed. Only attach retry authority when the owner still has work.
 */
export function throwAfterFailedRollback(args: {
  readonly primary: unknown;
  readonly rollbackErrors: readonly unknown[];
  readonly residualCleanup: ResidualCleanupOwner;
  readonly message: string;
}): never {
  if (args.residualCleanup.hasPending())
    throw new ResidualCleanupError(args);
  if (args.rollbackErrors.length === 0) throw args.primary;
  throw new AggregateError(
    [args.primary, ...args.rollbackErrors],
    args.message,
  );
}
