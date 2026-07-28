import type { MatchPhase, MinigameResult, RoleAssignment } from '../shared/types';
import { PHASE_LABELS } from '../shared/config';

export type PhaseListener = (phase: MatchPhase, prev: MatchPhase) => void;

/**
 * One-match finite state machine (architecture §4.4).
 * Transitions are Host-driven; clients mirror via net events.
 */
export class MatchFSM {
  phase: MatchPhase = 'Lobby';
  nodeIndex = -1;
  roleAssignment: RoleAssignment | null = null;
  lastMinigameResult: MinigameResult | null = null;
  private listeners = new Set<PhaseListener>();

  onChange(fn: PhaseListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private go(next: MatchPhase): void {
    if (next === this.phase) return;
    const prev = this.phase;
    this.phase = next;
    for (const fn of this.listeners) fn(next, prev);
  }

  label(): string {
    return PHASE_LABELS[this.phase];
  }

  // ── Host transition API ──────────────────────────────────────────────

  startMatch(): void {
    this.assert('Lobby');
    this.nodeIndex = -1;
    this.roleAssignment = null;
    this.lastMinigameResult = null;
    this.go('LoadingCutscene');
  }

  cutsceneDone(): void {
    this.assert('LoadingCutscene');
    this.go('CauldronCasting');
  }

  castingDone(assignment: RoleAssignment): void {
    this.assert('CauldronCasting');
    this.roleAssignment = assignment;
    this.go('RoleReveal');
  }

  rolesRevealed(): void {
    this.assert('RoleReveal');
    this.go('NarrativePlay');
  }

  narrativeDone(opts?: { finale?: boolean }): void {
    this.assert('NarrativePlay', 'FinaleNarrative');
    if (opts?.finale || this.phase === 'FinaleNarrative') {
      this.go('MatchResult');
      return;
    }
    this.go('MinigameLoad');
  }

  minigameReady(): void {
    this.assert('MinigameLoad');
    this.go('MinigamePlay');
  }

  minigameSettled(result: MinigameResult): void {
    this.assert('MinigamePlay');
    this.lastMinigameResult = result;
    this.go('NodeSettle');
  }

  /**
   * After node settle: advance playlist.
   * @param hasMoreNodes whether more minigame nodes remain
   */
  settleDone(hasMoreNodes: boolean): void {
    this.assert('NodeSettle');
    if (hasMoreNodes) {
      this.nodeIndex += 1;
      this.go('NarrativePlay'); // short interstitial narrative (optional content)
    } else {
      this.go('FinaleNarrative');
    }
  }

  /** Enter first node after opening narrative. */
  enterFirstNode(): void {
    this.assert('NarrativePlay');
    this.nodeIndex = 0;
    this.go('MinigameLoad');
  }

  backToLobby(): void {
    this.go('Lobby');
    this.nodeIndex = -1;
  }

  restartMatch(): void {
    this.nodeIndex = -1;
    this.roleAssignment = null;
    this.lastMinigameResult = null;
    this.go('LoadingCutscene');
  }

  /** Client mirror — apply Host-authoritative phase without transition checks. */
  forcePhase(phase: MatchPhase, nodeIndex?: number): void {
    const prev = this.phase;
    this.phase = phase;
    if (nodeIndex !== undefined) this.nodeIndex = nodeIndex;
    for (const fn of this.listeners) fn(phase, prev);
  }

  private assert(...allowed: MatchPhase[]): void {
    if (!allowed.includes(this.phase)) {
      throw new Error(`MatchFSM: expected ${allowed.join('|')}, got ${this.phase}`);
    }
  }
}
