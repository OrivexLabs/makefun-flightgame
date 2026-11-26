// The game's rules and state, with no drawing and no browser in it: the jet, the rings,
// the runways, fuel, damage and score. step() advances one fixed step and returns what
// happened as bit flags, so the caller can react without the world knowing about screens
// or sound. Nothing here allocates after createWorld returns.
import { COURSE, PLANE, RUNWAY, SCORE, STEP } from './config.js';
import { riverX, terrainHeight } from './noise.js';

export const EVENT_RING = 1;
export const EVENT_MISS = 2;
export const EVENT_CRASH = 4;
export const EVENT_LAND = 8;
export const EVENT_COMPLETE = 16;
export const EVENT_FUEL_LOW = 32;
export const EVENT_TAKEOFF = 64;

const GRAVITY = 9.81;
const KNOTS = 1.944;
const FEET = 3.281;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function normAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function createWorld(seed) {
  const rings = [];
  for (let index = 0; index < COURSE.rings; index += 1) {
    rings.push({
      x: COURSE.ringWeave * Math.sin(index * 1.1 + 0.5),
      y: COURSE.ringBaseHeight + COURSE.ringHeightSwing * Math.sin(index * 0.9 + 1.0),
      z: COURSE.firstRingZ + index * COURSE.ringSpacing,
      radius: COURSE.ringRadius,
      passed: false,
      missed: false,
    });
  }

  const plane = { x: 0, y: 0, z: 300, heading: 0, pitch: 0, roll: 0, speed: 0, throttle: 0 };
  const state = {
    plane,
    rings,
    seed,
    phase: 'ground',
    score: 0,
    fuel: 100,
    damage: 0,
    elapsed: 0,
    nextRing: 0,
    ringsPassed: 0,
    verticalSpeed: 0,
    message: '',
    messageUntil: 0,
    crashReason: '',
    landing: null,
    fuelLowAnnounced: false,
    fuelEmptyAnnounced: false,
  };

  function groundHeight(x, z) {
    return terrainHeight(x, z, seed);
  }

  function setMessage(text, seconds) {
    state.message = text;
    state.messageUntil = state.elapsed + seconds;
  }

  function reset() {
    plane.x = 0;
    plane.y = 0;
    plane.z = 300;
    plane.heading = 0;
    plane.pitch = 0;
    plane.roll = 0;
    plane.speed = 0;
    plane.throttle = 0;
    for (const ring of rings) {
      ring.passed = false;
      ring.missed = false;
    }
    state.phase = 'ground';
    state.score = 0;
    state.fuel = 100;
    state.damage = 0;
    state.elapsed = 0;
    state.nextRing = 0;
    state.ringsPassed = 0;
    state.verticalSpeed = 0;
    state.message = '';
    state.messageUntil = 0;
    state.crashReason = '';
    state.landing = null;
    state.fuelLowAnnounced = false;
    state.fuelEmptyAnnounced = false;
  }

  /**
   * Stage the final approach: the jet is on finals for the landing runway with every
   * ring already flown, so a screenshot can show the landing itself.
   */
  function placeForLanding() {
    reset();
    for (const ring of rings) {
      ring.passed = true;
    }
    state.nextRing = rings.length;
    state.ringsPassed = rings.length;
    state.score = COURSE.rings * SCORE.ring;
    plane.x = 0;
    plane.y = 150;
    plane.z = 6100;
    plane.heading = Math.PI;
    plane.pitch = -0.08;
    plane.roll = 0;
    plane.speed = 58;
    plane.throttle = 0.35;
    state.fuel = 60;
    state.phase = 'flying';
    setMessage('FINAL — runway ahead, throttle back, flare gently', 6);
  }

  function crash(reason) {
    state.phase = 'crashed';
    state.crashReason = reason;
    return EVENT_CRASH;
  }

  function checkRings(prevX, prevY, prevZ) {
    let events = 0;
    const index = state.nextRing;
    if (index >= rings.length) return events;
    const ring = rings[index];
    if (prevZ < ring.z && plane.z >= ring.z) {
      const t = (ring.z - prevZ) / Math.max(0.001, plane.z - prevZ);
      const cx = prevX + (plane.x - prevX) * t;
      const cy = prevY + (plane.y - prevY) * t;
      const distance = Math.hypot(cx - ring.x, cy - ring.y);
      if (distance < ring.radius) {
        ring.passed = true;
        state.ringsPassed += 1;
        state.nextRing += 1;
        state.score += SCORE.ring;
        events |= EVENT_RING;
        if (state.nextRing >= rings.length) {
          setMessage('ALL RINGS — turn back and land on the far runway', 6);
        } else {
          setMessage(`RING ${state.ringsPassed}/${COURSE.rings} — +${SCORE.ring}`, 2.5);
        }
      } else {
        ring.missed = true;
        state.nextRing += 1;
        events |= EVENT_MISS;
        setMessage(`MISSED RING ${index + 1} — press on`, 2.5);
      }
    } else if (plane.z > ring.z + 60) {
      ring.missed = true;
      state.nextRing += 1;
      events |= EVENT_MISS;
      setMessage(`MISSED RING ${index + 1} — press on`, 2.5);
    }
    return events;
  }

  function landTouchdown() {
    const sink = -state.verticalSpeed;
    const gentle = sink <= PLANE.maxSink
      && plane.speed <= PLANE.maxLandingSpeed
      && Math.abs(plane.roll) <= PLANE.maxLandingRoll;
    if (!gentle) {
      if (sink > PLANE.maxSink) return crash('hard landing');
      if (plane.speed > PLANE.maxLandingSpeed) return crash('too fast to land');
      return crash('landed banked');
    }
    state.phase = 'landed';
    state.landing = { sink, offset: Math.abs(plane.x) };
    setMessage('TOUCHDOWN — rolling out', 3);
    return EVENT_LAND;
  }

  /**
   * One fixed step. `controls` is { pitch, roll, throttle, brake }, each -1..1 (brake
   * is 0 or 1). With `harmless` set (the title screen's backdrop) the jet flies but
   * nothing scores, crashes or runs out of fuel.
   */
  function step(dt, controls, harmless) {
    let events = 0;
    if (state.phase === 'crashed' || state.phase === 'complete') return events;
    state.elapsed += dt;

    // Fuel: full throttle empties the tank in PLANE.fuelSeconds; cruising stretches it.
    if (state.fuel > 0 && !harmless) {
      state.fuel -= (0.25 + 0.75 * plane.throttle) * (100 / PLANE.fuelSeconds) * dt;
      if (state.fuel <= 20 && !state.fuelLowAnnounced) {
        state.fuelLowAnnounced = true;
        events |= EVENT_FUEL_LOW;
        setMessage('LOW FUEL — land soon', 4);
      }
      if (state.fuel <= 0) {
        state.fuel = 0;
        plane.throttle = 0;
        if (!state.fuelEmptyAnnounced) {
          state.fuelEmptyAnnounced = true;
          setMessage('FUEL EMPTY — gliding, find the runway', 5);
        }
      }
    }

    plane.throttle = clamp(plane.throttle + controls.throttle * 0.5 * dt, 0, 1);
    if (state.fuel <= 0) plane.throttle = 0;

    const rollTarget = controls.roll * PLANE.maxRoll;
    const rollStep = PLANE.rollRate * dt;
    plane.roll += clamp(rollTarget - plane.roll, -rollStep, rollStep);
    const pitchTarget = controls.pitch * PLANE.maxPitch;
    const pitchStep = PLANE.pitchRate * dt;
    plane.pitch += clamp(pitchTarget - plane.pitch, -pitchStep, pitchStep);

    if (state.phase === 'ground') {
      // Rolling down the takeoff runway; rotate once fast enough and pulling up.
      const target = plane.throttle * PLANE.maxSpeed;
      plane.speed += clamp(target - plane.speed, -PLANE.decel * dt, PLANE.accel * dt);
      plane.z += plane.speed * dt;
      if (plane.speed > 38 && controls.pitch > 0.04) {
        state.phase = 'flying';
        state.verticalSpeed = plane.speed * Math.sin(plane.pitch);
        events |= EVENT_TAKEOFF;
        setMessage('AIRBORNE — fly the rings', 3);
      }
      return events;
    }

    if (state.phase === 'landed') {
      // Rolling out: brakes and drag bleed the speed off.
      plane.speed = Math.max(0, plane.speed - (PLANE.decel + (controls.brake ? PLANE.brakeDecel : 0)) * dt);
      plane.x += Math.sin(plane.heading) * plane.speed * dt;
      plane.z += Math.cos(plane.heading) * plane.speed * dt;
      plane.pitch *= 0.9;
      plane.roll *= 0.9;
      if (plane.speed < 4) {
        state.phase = 'complete';
        const soft = Math.round(SCORE.landingSoftMax * (1 - state.landing.sink / PLANE.maxSink));
        const line = Math.round(SCORE.landingLineMax * (1 - state.landing.offset / RUNWAY.halfWidth));
        const fuelBonus = Math.round(state.fuel * SCORE.fuelPerPoint);
        const timeBonus = Math.round(Math.max(0, SCORE.timeParSeconds - state.elapsed) * SCORE.timePerSecond);
        state.landing.bonus = SCORE.landingBase + Math.max(0, soft) + Math.max(0, line) + fuelBonus + timeBonus;
        state.score += state.landing.bonus;
        state.landing.soft = Math.max(0, soft);
        state.landing.line = Math.max(0, line);
        state.landing.fuelBonus = fuelBonus;
        state.landing.timeBonus = timeBonus;
        events |= EVENT_COMPLETE;
      }
      return events;
    }

    // Flying: a coordinated turn from the bank, climb from the pitch, sink below stall.
    const turnRate = (GRAVITY * Math.tan(plane.roll)) / Math.max(25, plane.speed);
    plane.heading += turnRate * dt;
    const target = plane.throttle * PLANE.maxSpeed;
    if (plane.speed < target) plane.speed += PLANE.accel * dt;
    else plane.speed -= (PLANE.decel + (controls.brake ? PLANE.brakeDecel : 0)) * dt;
    plane.speed = Math.max(0, plane.speed);

    const sink = plane.speed < PLANE.stallSpeed ? (PLANE.stallSpeed - plane.speed) * 0.8 : 0;
    state.verticalSpeed = plane.speed * Math.sin(plane.pitch) - sink;
    const prevX = plane.x;
    const prevY = plane.y;
    const prevZ = plane.z;
    plane.x += Math.sin(plane.heading) * Math.cos(plane.pitch) * plane.speed * dt;
    plane.y += state.verticalSpeed * dt;
    plane.z += Math.cos(plane.heading) * Math.cos(plane.pitch) * plane.speed * dt;

    // Ceiling: the air thins out and the nose is pushed down.
    if (plane.y > 900) {
      plane.y = 900;
      plane.pitch = Math.min(plane.pitch, -0.05);
      setMessage('CEILING — too high', 2);
    }
    // The valley ends: steer back toward the course.
    if (Math.abs(plane.x) > 850 || plane.z < -300 || plane.z > 6500) {
      const home = Math.atan2(0 - plane.x, 3000 - plane.z);
      plane.heading += clamp(normAngle(home - plane.heading), -0.5 * dt, 0.5 * dt);
      setMessage('TURN BACK — the valley ends here', 2);
    }

    if (!harmless) events |= checkRings(prevX, prevY, prevZ);

    // Scraping the ground at speed bends the airframe (only once airborne, skimming
    // rough ground — the runways themselves are smooth).
    const ground = groundHeight(plane.x, plane.z);
    const clearance = plane.y - ground;
    if (state.phase === 'flying' && clearance > 1 && clearance < 3.5 && plane.speed > 40
      && !onRunwayPlane(plane.x, plane.z)) {
      state.damage += 25 * dt;
      if (state.damage >= 100) return crash('airframe failure');
      setMessage('TERRAIN — pull up!', 1);
    }

    // Touchdown or impact: only while descending. A climbing jet just off the runway
    // (or skimming a rise) rides at ground clearance instead.
    if (plane.y <= ground + 1.5) {
      if (state.verticalSpeed < -0.5) {
        if (onRunwayPlane(plane.x, plane.z) && !harmless) {
          plane.y = ground + 1.5;
          return landTouchdown();
        }
        if (harmless) {
          plane.y = ground + 1.5;
        } else {
          plane.y = ground + 1.5;
          return crash(ground < 9 && Math.abs(plane.x - riverX(plane.z)) < 30 ? 'ditched in the river' : 'hit the terrain');
        }
      } else {
        plane.y = ground + 1.5;
      }
    }
    return events;
  }

  /** Is the jet over a runway strip (either one)? */
  function onRunwayPlane(x, z) {
    if (Math.abs(x) > RUNWAY.halfWidth) return false;
    return (z >= RUNWAY.takeoff.z0 && z <= RUNWAY.takeoff.z1)
      || (z >= RUNWAY.landing.z0 && z <= RUNWAY.landing.z1);
  }

  reset();
  return {
    state,
    reset,
    step,
    groundHeight,
    placeForLanding,
    knots() {
      return Math.round(plane.speed * KNOTS);
    },
    feet() {
      return Math.round(plane.y * FEET);
    },
    headingDegrees() {
      return Math.round(((plane.heading * 180) / Math.PI % 360 + 360) % 360);
    },
    nextRing() {
      return state.nextRing < rings.length ? rings[state.nextRing] : null;
    },
  };
}
