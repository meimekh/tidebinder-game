// A small seeded random number generator (mulberry32) and the helpers built on it. The same seed
// gives the same harbour, the same salvage, the same storm: that is what makes ?seed= repeatable
// and the screenshot scenes stable.

export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded stream with the little distributions the spawner wants. */
export function createStream(seed) {
  const random = createRandom(seed);
  return {
    random,
    /** A float in [min, max). */
    range(min, max) {
      return min + (max - min) * random();
    },
    /** An integer in [min, max]. */
    int(min, max) {
      return min + Math.floor(random() * (max - min + 1));
    },
    /** -1 or 1. */
    sign() {
      return random() < 0.5 ? -1 : 1;
    },
    /** A random point on the unit circle. */
    angle() {
      return random() * Math.PI * 2;
    },
    pick(list) {
      return list[Math.floor(random() * list.length)];
    },
  };
}
