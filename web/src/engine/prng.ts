/**
 * Deterministic PRNG for OpenMoW-Web simulation engine.
 * Mulberry32 implementation: fast, 32-bit deterministic generator.
 * Math.random is strictly prohibited in the engine.
 */

export class PRNG {
  private s: number;

  constructor(seed = 123456789) {
    this.s = seed >>> 0;
  }

  /** Return the current 32-bit unsigned seed state */
  get state(): number {
    return this.s;
  }

  /** Set the internal state */
  set state(val: number) {
    this.s = val >>> 0;
  }

  /** Generate next pseudo-random uint32 in [0, 2^32 - 1] */
  nextUint32(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1) */
  nextFloat(): number {
    return this.nextUint32() / 4294967296.0;
  }

  /** Integer in [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  /** Float in [min, max) */
  nextRange(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }
}
