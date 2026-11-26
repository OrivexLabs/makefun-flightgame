// Seeded value noise and the valley's heightfield. Everything here is a pure function of
// (x, z, seed), so the same seed always builds the same mountains, river and runways.

import { RUNWAY } from './config.js';

/** A small seeded random number generator (mulberry32). */
export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic hash of one lattice point: a fixed number in [0, 1). */
export function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise at world coordinates (x, z), in metres. */
export function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Fractal noise: a few octaves of value noise, still in [0, 1). */
export function fbm(x, z, seed, octaves) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amp * valueNoise(x * freq, z * freq, seed + octave * 101);
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

/** The river's centreline: it winds down the valley floor. */
export function riverX(z) {
  return 260 * Math.sin(z * 0.0011 + 1.7) + 90 * Math.sin(z * 0.0031 + 0.4);
}

/** Is (x, z) on a runway strip (takeoff or landing)? */
export function onRunway(x, z) {
  if (Math.abs(x) > RUNWAY.halfWidth) return false;
  return (z >= RUNWAY.takeoff.z0 && z <= RUNWAY.takeoff.z1)
    || (z >= RUNWAY.landing.z0 && z <= RUNWAY.landing.z1);
}

/**
 * Terrain height in metres at (x, z). A flat valley floor along x = 0 carries the river
 * and both runways; ridged mountains rise on either side. The runways are flattened to 0.
 */
export function terrainHeight(x, z, seed) {
  const ax = Math.abs(x);
  // Mountains rise with distance from the valley centreline.
  const ridge = smooth(Math.min(1, Math.max(0, (ax - 60) / 360)));
  let h = 24 * fbm(x * 0.004, z * 0.004, seed, 3)
    + 10 * fbm(x * 0.015, z * 0.015, seed + 7, 2);
  h += ridge * (70 + 150 * fbm(x * 0.002 + 40, z * 0.002, seed + 13, 3));
  h += ridge * ridge * 60 * fbm(x * 0.006, z * 0.006, seed + 29, 2);
  // The river carves a channel down the valley floor.
  const riverDistance = Math.abs(x - riverX(z));
  if (riverDistance < 60) {
    const carve = smooth(1 - riverDistance / 60);
    h = h * (1 - carve) + 5 * carve;
  }
  // The runways are flat: blend to 0 near either strip.
  if (ax < RUNWAY.halfWidth + 40) {
    const nearTakeoff = z >= RUNWAY.takeoff.z0 - 40 && z <= RUNWAY.takeoff.z1 + 40;
    const nearLanding = z >= RUNWAY.landing.z0 - 40 && z <= RUNWAY.landing.z1 + 40;
    if (nearTakeoff || nearLanding) {
      const edge = smooth(Math.min(1, Math.max(0, (ax - RUNWAY.halfWidth) / 40)));
      h *= edge;
    }
  }
  return Math.max(0, h);
}
