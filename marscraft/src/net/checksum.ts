/**
 * MarsCraft -> forgeax-engine — desync-detection checksum (Milestone M15 chunk 1)
 * =============================================================================
 * Port of the Three.js source `shared/sync/Checksum.ts` (VERBATIM logic).
 *
 * FNV-1a 32-bit hash used to fingerprint the sim's critical state. In a real
 * networked game each peer computes this every `CHECKSUM_INTERVAL_TURNS` turns
 * and the authoritative room compares them — a mismatch = desync. In the local
 * lockstep demo (chunk 1) the SAME builder is used to prove that identical state
 * yields an identical fingerprint (see ./checksum-computer.ts + lockstep-demo.ts).
 */

// ============================================================================
// FNV-1a constants
// ============================================================================

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// ============================================================================
// ChecksumBuilder — accumulate ints/quantized-floats into one 32-bit hash
// ============================================================================

export class ChecksumBuilder {
  private hash: number = FNV_OFFSET;

  feedInt(value: number): this {
    value = value | 0;
    this.hash ^= (value & 0xff);
    this.hash = Math.imul(this.hash, FNV_PRIME);
    this.hash ^= ((value >> 8) & 0xff);
    this.hash = Math.imul(this.hash, FNV_PRIME);
    this.hash ^= ((value >> 16) & 0xff);
    this.hash = Math.imul(this.hash, FNV_PRIME);
    this.hash ^= ((value >> 24) & 0xff);
    this.hash = Math.imul(this.hash, FNV_PRIME);
    return this;
  }

  /**
   * Quantize a float to `precision` steps before hashing. Quantization is what
   * makes the checksum stable across cosmetically-irrelevant sub-quantum drift
   * (and, in the real game, across FP rounding on different CPUs).
   */
  feedFloat(value: number, precision: number = 1000): this {
    return this.feedInt(Math.round(value * precision));
  }

  finalize(): number {
    return this.hash >>> 0;
  }

  reset(): this {
    this.hash = FNV_OFFSET;
    return this;
  }
}

// ============================================================================
// ChecksumResult
// ============================================================================

export interface ChecksumResult {
  checksum: number;
  entityCount: number;
  rngState: number;
  rngCallCount: number;
}

// ============================================================================
// How often a peer computes + reports its checksum (every N turns).
// ============================================================================

export const CHECKSUM_INTERVAL_TURNS = 10;
