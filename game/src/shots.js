// The screenshot scenes behind ?shot=start|play|land|end. Each one plays the real rules
// forward from a real state, steered by an autopilot that aims at the next ring or the
// runway, so the frame is what a short game really looks like and the same seed always
// gives the same frame.
import { COURSE, PLANE, STEP } from './config.js';
import { onRunway, terrainHeight } from './noise.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 8;
const PLAY_SECONDS = 30;
const LAND_LIMIT_SECONDS = 150;
const END_LIMIT_SECONDS = 600;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function normAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

/**
 * Steer toward a target point: bank to turn onto it, pitch to meet its height, throttle
 * to hold a sensible speed. `skill` scales how hard the pilot pulls: 1 is a careful
 * pilot, 0.45 is a hurried one that gets caught out. The pilot reads the terrain ahead
 * and climbs over it rather than flying through a ridge, and banks for the turn rate
 * the heading error needs, not just the error itself.
 */
export function autopilot(state, skill) {
  const plane = state.plane;
  if (state.phase === 'ground') {
    return { pitch: 0.6, roll: 0, throttle: 1, brake: false };
  }
  if (state.phase === 'landed' || state.phase === 'complete') {
    return { pitch: 0, roll: 0, throttle: -1, brake: true };
  }
  let target;
  let throttle;
  // On final: lined up on the landing runway (heading near south, inside the
  // final zone) with every ring flown. Once on final, the glide path rules and
  // the terrain-avoidance floors stand down: the jet must descend to the strip.
  const aligned = Math.abs(normAngle(plane.heading - Math.PI)) < 1.0;
  const inFinalZone = plane.z > 4200 && plane.z < 6200;
  const onFinal = state.nextRing >= COURSE.rings && aligned && inFinalZone;
  if (state.nextRing < COURSE.rings) {
    const ring = state.rings[state.nextRing];
    target = { x: ring.x, y: ring.y, z: ring.z };
    throttle = 0.65;
  } else if (!onFinal) {
    // Return leg: fly to a downwind point past the far runway, then turn onto final.
    target = { x: 0, y: 130, z: 6050 };
    throttle = 0.45;
  } else {
    // Final: aim 350 m ahead along the glide path, never at a point on the ground,
    // so the aim never ends up behind the jet. The glide aims below the runway
    // surface, so the descent never flattens out above it: the jet keeps sinking
    // gently until the wheels meet the strip. Aim across the centreline, so a
    // sideways offset corrects itself instead of lingering.
    const aimZ = plane.z - 350;
    const glideY = clamp((aimZ - 4800) * 0.05, -5, 110);
    target = { x: plane.x * -0.5, y: glideY, z: aimZ };
    throttle = plane.speed > 58 ? 0.12 : 0.42;
  }
  const dx = target.x - plane.x;
  const dy = target.y - plane.y;
  const dz = target.z - plane.z;
  const desiredHeading = Math.atan2(dx, dz);
  const headingError = normAngle(desiredHeading - plane.heading);
  const horizontal = Math.max(30, Math.hypot(dx, dz));
  let desiredPitch = clamp(Math.atan2(dy, horizontal), -0.35, 0.35);
  // Terrain ahead: never aim below the ground 100 m in front plus a margin — but
  // trust the ring line when close to a ring, and never over a runway, where the
  // whole point is to descend to the ground.
  const farFromTarget = horizontal > 300;
  const aheadX = plane.x + Math.sin(plane.heading) * 100;
  const aheadZ = plane.z + Math.cos(plane.heading) * 100;
  const terrainAhead = terrainHeight(aheadX, aheadZ, state.seed);
  const clearance = plane.y - terrainHeight(plane.x, plane.z, state.seed);
  const overRunway = onRunway(plane.x, plane.z) || onRunway(aheadX, aheadZ);
  if (!onFinal && !overRunway && farFromTarget && plane.y < terrainAhead + 30) desiredPitch = Math.max(desiredPitch, 0.18);
  if (!onFinal && !overRunway && farFromTarget && clearance < 40) desiredPitch = Math.max(desiredPitch, 0.12);
  if (!onFinal && !overRunway && clearance < 25) desiredPitch = Math.max(desiredPitch, 0.3);
  // Bank for the turn rate the heading error needs, not just the error itself.
  const turnRateNeeded = clamp(headingError / 1.5, -0.5, 0.5);
  const rollTarget = clamp(Math.atan((plane.speed * turnRateNeeded) / 9.81), -PLANE.maxRoll, PLANE.maxRoll);
  const roll = rollTarget * skill;
  // Feed the desired pitch forward (the stick value that holds it) plus a correction
  // for the error: without the feedforward the jet only ever reaches half the pitch.
  const pitch = clamp(desiredPitch / PLANE.maxPitch + (desiredPitch - plane.pitch) * 2.0, -1, 1) * skill;
  return { pitch, roll, throttle: throttle > plane.throttle ? 1 : -1, brake: false };
}

/**
 * The reckless pilot for the end scene: rotates and climbs off the runway, holds the
 * climb a while, then pushes the nose down in a lazy bank and flies into the valley side.
 */
function recklessPilot(state) {
  if (state.phase === 'ground') return { pitch: 0.5, roll: 0, throttle: 1, brake: false };
  if (state.elapsed < 14) return { pitch: 0.4, roll: 0, throttle: 1, brake: false };
  return { pitch: -0.3, roll: 0.35, throttle: 1, brake: false };
}

/**
 * Set `world` to the named scene (start, play, land or end; any other name is start)
 * and return the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  const state = world.state;
  if (name === 'land') {
    world.placeForLanding();
    for (let index = 0; index < LAND_LIMIT_SECONDS / STEP; index += 1) {
      if (state.phase === 'complete' || state.phase === 'crashed') break;
      world.step(STEP, autopilot(state, 1), false);
    }
    return { screen: state.phase === 'complete' || state.phase === 'crashed' ? SCREEN_OVER : SCREEN_PLAY, best: state.score };
  }
  if (name === 'end') {
    world.reset();
    for (let index = 0; index < END_LIMIT_SECONDS / STEP; index += 1) {
      if (state.phase === 'crashed' || state.phase === 'complete') break;
      world.step(STEP, recklessPilot(state), false);
    }
    return { screen: SCREEN_OVER, best: state.score };
  }
  world.reset();
  if (name !== 'play') {
    for (let index = 0; index < START_SECONDS / STEP; index += 1) {
      world.step(STEP, autopilot(state, 1), true);
    }
    return { screen: SCREEN_TITLE, best: 0 };
  }
  for (let index = 0; index < PLAY_SECONDS / STEP; index += 1) {
    if (state.phase === 'crashed' || state.phase === 'complete') break;
    world.step(STEP, autopilot(state, 1), false);
  }
  const over = state.phase === 'crashed' || state.phase === 'complete';
  return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: state.score };
}
