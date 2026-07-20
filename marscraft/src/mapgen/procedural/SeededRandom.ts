/**
 * Seeded PRNG — 确定性随机数生成器
 * 相同 seed 产生完全相同的序列，保证地图可复现
 */
export class SeededRandom {
  private s: number

  constructor(seed: number) {
    this.s = seed & 0x7fffffff
    if (this.s === 0) this.s = 1
  }

  /** 返回 [0, 1) */
  next(): number {
    this.s = (this.s * 1103515245 + 12345) & 0x7fffffff
    return this.s / 0x7fffffff
  }

  /** 返回 [0, max) 整数 */
  nextInt(max: number): number {
    return Math.floor(this.next() * max)
  }

  /** 返回 [min, max] 整数 */
  nextRange(min: number, max: number): number {
    return min + this.nextInt(max - min + 1)
  }

  /** 返回 [min, max) 浮点 */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Fisher-Yates 洗牌 */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1)
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
}
