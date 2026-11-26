// Drawing only: the world's state and the current screen in, pixels out. The 1280x720
// playfield is scaled to fit the window and centred, the margin filled with the backdrop
// colour. The world is a real 3D projection: a heightfield valley, two runways, a river,
// glowing rings and clouds, seen from a chase camera behind the jet; the HUD, panels and
// attitude indicator are drawn unrotated on top.
import { CAMERA, COURSE, FIELD, FONT, PALETTE, PLANE, RUNWAY, TERRAIN } from './config.js';
import { hash2, riverX, terrainHeight } from './noise.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const CENTER_X = FIELD.width / 2;
const CENTER_Y = FIELD.height / 2;
const FOCAL = (FIELD.height / 2) / Math.tan(((CAMERA.fovDegrees / 2) * Math.PI) / 180);
const SUN_AZIMUTH = 2.4;
const SUN_ELEVATION = 0.5;
const VROWS = Math.floor(TERRAIN.ahead / TERRAIN.step) + 1;
const VCOLS = Math.floor((TERRAIN.halfWidth * 2) / TERRAIN.stepX) + 1;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function normAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function mixColor(a, b, t) {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

function colorForHeight(h, x, z, seed) {
  if (h < 8) return PALETTE.sand;
  if (h < 25) return PALETTE.grass;
  if (h < 55) return PALETTE.scrub;
  if (h < 110) return PALETTE.rock;
  return PALETTE.snow;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const fonts = new Map();
  // Scratch grids for the terrain projection, allocated once and reused.
  const gridX = new Float64Array(VROWS * VCOLS);
  const gridY = new Float64Array(VROWS * VCOLS);
  const gridD = new Float64Array(VROWS * VCOLS);
  const gridH = new Float64Array(VROWS * VCOLS);
  const gridOk = new Uint8Array(VROWS * VCOLS);
  const clouds = [];
  {
    let s = 1234567;
    const rand = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let index = 0; index < 26; index += 1) {
      clouds.push({
        x: (rand() - 0.5) * 1500,
        y: 190 + rand() * 170,
        z: rand() * 6200,
        size: 50 + rand() * 70,
      });
    }
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align, baseline) {
    if (!fonts.has(size)) fonts.set(size, `${size}px ${FONT}`);
    context.font = fonts.get(size);
    context.fillStyle = color;
    context.textAlign = align ?? 'left';
    context.textBaseline = baseline ?? context.textBaseline;
    context.fillText(value, x, y);
  }

  /** Camera basis for this frame: position, heading, pitch and the horizon line. */
  function cameraFor(state) {
    const plane = state.plane;
    const forwardX = Math.sin(plane.heading) * Math.cos(plane.pitch);
    const forwardY = Math.sin(plane.pitch);
    const forwardZ = Math.cos(plane.heading) * Math.cos(plane.pitch);
    const cam = {
      x: plane.x - forwardX * CAMERA.behind,
      y: Math.max(3, plane.y - forwardY * CAMERA.behind + CAMERA.above),
      z: plane.z - forwardZ * CAMERA.behind,
      heading: plane.heading,
      pitch: plane.pitch * 0.55,
    };
    cam.horizonY = CENTER_Y - Math.tan(cam.pitch) * FOCAL;
    return cam;
  }

  /** Project a world point to playfield pixels; null when behind the camera. */
  function project(cam, x, y, z) {
    const dx = x - cam.x;
    const dy = y - cam.y;
    const dz = z - cam.z;
    const sinH = Math.sin(cam.heading);
    const cosH = Math.cos(cam.heading);
    const camX = dx * cosH - dz * sinH;
    const camZ = dx * sinH + dz * cosH;
    if (camZ < 2) return null;
    const cosP = Math.cos(cam.pitch);
    const sinP = Math.sin(cam.pitch);
    const y2 = dy * cosP - camZ * sinP;
    const z2 = dy * sinP + camZ * cosP;
    if (z2 < 2) return null;
    return { x: CENTER_X + (camX * FOCAL) / z2, y: CENTER_Y - (y2 * FOCAL) / z2, dist: camZ };
  }

  function drawSky(cam, state) {
    const gradient = context.createLinearGradient(0, 0, 0, FIELD.height);
    gradient.addColorStop(0, PALETTE.skyTop);
    gradient.addColorStop(0.45, PALETTE.skyMid);
    gradient.addColorStop(0.62, PALETTE.skyLow);
    gradient.addColorStop(0.63, PALETTE.haze);
    gradient.addColorStop(1, '#6d8a68');
    context.fillStyle = gradient;
    context.fillRect(-400, -400, FIELD.width + 800, FIELD.height + 800);
    // The sun, fixed in the sky, sliding sideways as the jet turns.
    const sunAngle = normAngle(SUN_AZIMUTH - cam.heading);
    if (Math.abs(sunAngle) < 1.1) {
      const sx = CENTER_X + Math.tan(sunAngle) * FOCAL;
      const sy = cam.horizonY - Math.tan(SUN_ELEVATION) * FOCAL;
      const glow = context.createRadialGradient(sx, sy, 4, sx, sy, 130);
      glow.addColorStop(0, 'rgba(255, 243, 196, 0.95)');
      glow.addColorStop(0.25, 'rgba(255, 220, 140, 0.45)');
      glow.addColorStop(1, 'rgba(255, 220, 140, 0)');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(sx, sy, 130, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = PALETTE.sun;
      context.beginPath();
      context.arc(sx, sy, 26, 0, Math.PI * 2);
      context.fill();
    }
    // Two hazy ridge layers for depth behind the terrain grid.
    for (let layer = 0; layer < 2; layer += 1) {
      const amp = layer === 0 ? 55 : 85;
      const amp2 = layer === 0 ? 22 : 34;
      const phase = cam.heading * (layer === 0 ? 2.1 : 3.7);
      const base = cam.horizonY - (layer === 0 ? 26 : 8);
      context.fillStyle = layer === 0 ? PALETTE.ridgeFar : PALETTE.ridgeNear;
      context.beginPath();
      context.moveTo(-20, FIELD.height);
      for (let sx = -20; sx <= FIELD.width + 20; sx += 20) {
        const sy = base - amp * Math.abs(Math.sin(sx * 0.004 + phase)) - amp2 * Math.abs(Math.sin(sx * 0.011 - phase * 2));
        context.lineTo(sx, sy);
      }
      context.lineTo(FIELD.width + 20, FIELD.height);
      context.closePath();
      context.fill();
    }
  }

  function drawTerrain(cam, state) {
    const plane = state.plane;
    const seed = state.seed;
    const aheadSign = Math.cos(cam.heading) >= 0 ? 1 : -1;
    const zStart = cam.z + aheadSign * 10;
    const xStart = cam.x - TERRAIN.halfWidth;
    // Project every grid vertex once.
    for (let row = 0; row < VROWS; row += 1) {
      const z = zStart + aheadSign * row * TERRAIN.step;
      for (let col = 0; col < VCOLS; col += 1) {
        const x = xStart + col * TERRAIN.stepX;
        const h = terrainHeight(x, z, seed);
        const index = row * VCOLS + col;
        gridH[index] = h;
        const p = project(cam, x, h, z);
        if (p === null) {
          gridOk[index] = 0;
        } else {
          gridOk[index] = 1;
          gridX[index] = p.x;
          gridY[index] = p.y;
          gridD[index] = p.dist;
        }
      }
    }
    // Quads, far to near.
    for (let row = VROWS - 2; row >= 0; row -= 1) {
      const z = zStart + aheadSign * (row + 0.5) * TERRAIN.step;
      for (let col = 0; col < VCOLS - 1; col += 1) {
        const i00 = row * VCOLS + col;
        const i01 = i00 + 1;
        const i10 = i00 + VCOLS;
        const i11 = i10 + 1;
        if (!gridOk[i00] || !gridOk[i01] || !gridOk[i10] || !gridOk[i11]) continue;
        const cx = xStart + (col + 0.5) * TERRAIN.stepX;
        const hc = (gridH[i00] + gridH[i01] + gridH[i10] + gridH[i11]) / 4;
        const dist = (gridD[i00] + gridD[i01] + gridD[i10] + gridD[i11]) / 4;
        let color;
        const onRunway = Math.abs(cx) < RUNWAY.halfWidth
          && ((z >= RUNWAY.takeoff.z0 && z <= RUNWAY.takeoff.z1)
            || (z >= RUNWAY.landing.z0 && z <= RUNWAY.landing.z1));
        if (onRunway) {
          const onLine = Math.abs(cx) < 1.6 && (Math.floor(z / 40) % 2 === 0);
          const threshold = (z < RUNWAY.takeoff.z0 + 60 || z > RUNWAY.takeoff.z1 - 60
            || z < RUNWAY.landing.z0 + 60 || z > RUNWAY.landing.z1 - 60) && Math.abs(cx) > 6 && Math.abs(cx) < 16;
          color = onLine || threshold ? PALETTE.runwayLine : PALETTE.asphalt;
        } else if (hc < 9 && Math.abs(cx - riverX(z)) < 28) {
          color = PALETTE.water;
        } else {
          color = colorForHeight(Math.floor(hc / 8) * 8, cx, z, seed);
        }
        // Slope shading: faces rising away from the camera read darker.
        const slope = clamp((gridH[i10] - gridH[i00]) / 18, -1, 1);
        const fog = clamp((dist - 90) / 380, 0, 0.82);
        if (slope !== 0) color = mixColor(color, slope > 0 ? '#000000' : '#ffffff', Math.abs(slope) * 0.1);
        if (fog > 0) color = mixColor(color, PALETTE.haze, fog);
        context.fillStyle = color;
        context.beginPath();
        context.moveTo(gridX[i00], gridY[i00]);
        context.lineTo(gridX[i01], gridY[i01]);
        context.lineTo(gridX[i11], gridY[i11]);
        context.lineTo(gridX[i10], gridY[i10]);
        context.closePath();
        context.fill();
      }
    }
  }

  function drawRings(cam, state) {
    for (let index = 0; index < state.rings.length; index += 1) {
      const ring = state.rings[index];
      if (ring.passed || ring.missed) continue;
      const p = project(cam, ring.x, ring.y, ring.z);
      if (p === null || p.dist > 1100) continue;
      const radius = (ring.radius * FOCAL) / p.dist;
      if (radius < 3) continue;
      const isNext = index === state.nextRing;
      const pulse = isNext ? 0.75 + 0.25 * Math.sin(state.elapsed * 5) : 0.8;
      context.globalAlpha = pulse;
      context.strokeStyle = PALETTE.ringGlow;
      context.lineWidth = Math.max(2, radius * 0.22);
      context.beginPath();
      context.arc(p.x, p.y, radius, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = PALETTE.ring;
      context.lineWidth = Math.max(1.5, radius * 0.09);
      context.beginPath();
      context.arc(p.x, p.y, radius, 0, Math.PI * 2);
      context.stroke();
      if (radius > 14) {
        text(String(index + 1), p.x, p.y - radius - 8, 18, PALETTE.ring, 'center');
      }
      context.globalAlpha = 1;
    }
  }

  function drawClouds(cam, state) {
    context.fillStyle = 'rgba(255, 255, 255, 0.8)';
    for (const cloud of clouds) {
      const p = project(cam, cloud.x, cloud.y, cloud.z);
      if (p === null || p.dist > 1400 || p.dist < 25) continue;
      const scale = FOCAL / p.dist;
      const size = cloud.size * scale;
      if (size < 4) continue;
      context.globalAlpha = clamp(1.1 - p.dist / 1400, 0.25, 0.8);
      context.beginPath();
      context.ellipse(p.x, p.y, size, size * 0.38, 0, 0, Math.PI * 2);
      context.ellipse(p.x - size * 0.6, p.y + size * 0.08, size * 0.6, size * 0.3, 0, 0, Math.PI * 2);
      context.ellipse(p.x + size * 0.6, p.y + size * 0.08, size * 0.6, size * 0.3, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function drawAircraft(state) {
    const plane = state.plane;
    const flicker = 0.85 + 0.15 * Math.sin(state.elapsed * 31) * Math.sin(state.elapsed * 17);
    const burn = clamp(plane.throttle, 0, 1) * flicker;
    const cx = CENTER_X;
    const cy = CENTER_Y + 34 + plane.pitch * 30;
    const scale = 1 + plane.pitch * 0.12;
    context.save();
    context.translate(cx, cy);
    context.scale(scale, scale);
    // Afterburner glow.
    if (burn > 0.05 && state.phase !== 'ground') {
      const glow = context.createRadialGradient(0, 52, 2, 0, 62, 46 * burn + 10);
      glow.addColorStop(0, 'rgba(255, 190, 90, 0.9)');
      glow.addColorStop(0.5, 'rgba(255, 120, 40, 0.45)');
      glow.addColorStop(1, 'rgba(255, 120, 40, 0)');
      context.fillStyle = glow;
      context.beginPath();
      context.ellipse(0, 62, 26 * burn + 8, 40 * burn + 8, 0, 0, Math.PI * 2);
      context.fill();
    }
    // Wings: swept back, seen from behind and above.
    context.fillStyle = PALETTE.jetDark;
    context.beginPath();
    context.moveTo(-14, 18);
    context.lineTo(-118, 58);
    context.lineTo(-108, 72);
    context.lineTo(-10, 44);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(14, 18);
    context.lineTo(118, 58);
    context.lineTo(108, 72);
    context.lineTo(10, 44);
    context.closePath();
    context.fill();
    // Tailplanes.
    context.fillStyle = PALETTE.jetDark;
    context.beginPath();
    context.moveTo(-10, 52);
    context.lineTo(-58, 76);
    context.lineTo(-50, 84);
    context.lineTo(-8, 64);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(10, 52);
    context.lineTo(58, 76);
    context.lineTo(50, 84);
    context.lineTo(8, 64);
    context.closePath();
    context.fill();
    // Fuselage: tail cone at the bottom (nearest the camera) tapering to the nose.
    const body = context.createLinearGradient(-16, 0, 16, 0);
    body.addColorStop(0, '#8fa2b3');
    body.addColorStop(0.5, PALETTE.jetBody);
    body.addColorStop(1, '#8fa2b3');
    context.fillStyle = body;
    context.beginPath();
    context.moveTo(-7, -58);
    context.quadraticCurveTo(-16, -10, -15, 62);
    context.quadraticCurveTo(0, 74, 15, 62);
    context.quadraticCurveTo(16, -10, 7, -58);
    context.closePath();
    context.fill();
    // Canopy hint and spine.
    context.fillStyle = '#2c4a63';
    context.beginPath();
    context.ellipse(0, -34, 6, 16, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(90, 107, 125, 0.7)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, -56);
    context.lineTo(0, 60);
    context.stroke();
    // Vertical stabiliser.
    context.fillStyle = PALETTE.jetAccent;
    context.beginPath();
    context.moveTo(-4, -52);
    context.lineTo(-9, -96);
    context.lineTo(9, -96);
    context.lineTo(4, -52);
    context.closePath();
    context.fill();
    // Engine nozzles.
    context.fillStyle = '#2b3138';
    context.beginPath();
    context.arc(-8, 58, 7, 0, Math.PI * 2);
    context.arc(8, 58, 7, 0, Math.PI * 2);
    context.fill();
    // Wingtip lights: red left, green right.
    context.fillStyle = '#ff4a3d';
    context.beginPath();
    context.arc(-112, 64, 4, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#3dff7a';
    context.beginPath();
    context.arc(112, 64, 4, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawSpeedLines(state) {
    const plane = state.plane;
    if (plane.speed < 65 || state.phase !== 'flying') return;
    const frame = Math.floor(state.elapsed * 24);
    const strength = clamp((plane.speed - 65) / 30, 0.15, 0.6);
    context.strokeStyle = `rgba(255, 255, 255, ${strength})`;
    context.lineWidth = 2;
    for (let index = 0; index < 10; index += 1) {
      const angle = hash2(index, frame, 99) * Math.PI * 2;
      const radius = 300 + hash2(index, frame + 1, 99) * 260;
      const length = 24 + hash2(index, frame + 2, 99) * 40;
      const x1 = CENTER_X + Math.cos(angle) * radius;
      const y1 = CENTER_Y + Math.sin(angle) * radius * 0.7;
      const x2 = CENTER_X + Math.cos(angle) * (radius + length);
      const y2 = CENTER_Y + Math.sin(angle) * (radius + length) * 0.7;
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    }
  }

  function drawWorld(state) {
    const cam = cameraFor(state);
    context.save();
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    // Roll the world, not the HUD: the horizon banks with the jet.
    context.translate(CENTER_X, CENTER_Y);
    context.rotate(-state.plane.roll);
    context.translate(-CENTER_X, -CENTER_Y);
    drawSky(cam, state);
    drawTerrain(cam, state);
    drawClouds(cam, state);
    drawRings(cam, state);
    drawAircraft(state);
    drawSpeedLines(state);
    context.restore();
  }

  function compassLabel(degrees) {
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return names[Math.round(degrees / 45) % 8];
  }

  function drawHud(state, screen, best) {
    const plane = state.plane;
    context.save();
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    context.textBaseline = 'top';
    // Airspeed, left; altitude, right.
    text(`${Math.round(plane.speed * 1.944)}`, 28, 16, 44, PALETTE.hud, 'left');
    text('KT', 28 + 44 * String(Math.round(plane.speed * 1.944)).length * 0.62, 34, 20, PALETTE.hudDim, 'left');
    text('AIRSPEED', 28, 66, 15, PALETTE.hudDim, 'left');
    const altText = `${Math.round(plane.y * 3.281).toLocaleString('en-US')}`;
    text(altText, FIELD.width - 28, 16, 44, PALETTE.hud, 'right');
    text('FT', FIELD.width - 28 - 44 * altText.length * 0.62, 34, 20, PALETTE.hudDim, 'right');
    text('ALTITUDE', FIELD.width - 28, 66, 15, PALETTE.hudDim, 'right');
    // Heading tape, centred on top.
    const heading = ((plane.heading * 180) / Math.PI % 360 + 360) % 360;
    const tapeWidth = 340;
    const tapeX = CENTER_X - tapeWidth / 2;
    context.fillStyle = 'rgba(10, 16, 32, 0.45)';
    context.fillRect(tapeX, 14, tapeWidth, 46);
    for (let offset = -60; offset <= 60; offset += 15) {
      const degrees = Math.round((heading + offset) / 15) * 15;
      const norm = ((degrees % 360) + 360) % 360;
      const x = CENTER_X + ((norm - heading + 540) % 360 - 180) * (tapeWidth / 120);
      if (x < tapeX + 6 || x > tapeX + tapeWidth - 6) continue;
      const major = norm % 45 === 0;
      context.strokeStyle = PALETTE.hudDim;
      context.lineWidth = major ? 2 : 1;
      context.beginPath();
      context.moveTo(x, 18);
      context.lineTo(x, major ? 34 : 28);
      context.stroke();
      if (major) text(compassLabel(norm), x, 36, 14, PALETTE.hud, 'center');
    }
    text(`${String(Math.round(heading)).padStart(3, '0')}°`, CENTER_X, 62, 18, PALETTE.hud, 'center');
    // Score and rings.
    text(`SCORE ${state.score.toLocaleString('en-US')}`, CENTER_X, 88, 22, PALETTE.hud, 'center');
    text(`RINGS ${state.ringsPassed}/${COURSE.rings}`, CENTER_X, 114, 17, PALETTE.hudDim, 'center');
    // Throttle bar, left edge; fuel and damage, right edge.
    const barX = 28;
    const barTop = 150;
    const barHeight = 170;
    context.fillStyle = 'rgba(10, 16, 32, 0.45)';
    context.fillRect(barX - 4, barTop - 4, 26, barHeight + 8);
    context.fillStyle = PALETTE.hudDim;
    context.fillRect(barX, barTop + barHeight * (1 - plane.throttle), 18, barHeight * plane.throttle);
    text('THR', barX + 9, barTop + barHeight + 10, 14, PALETTE.hudDim, 'center');
    const fuelX = FIELD.width - 46;
    context.fillStyle = 'rgba(10, 16, 32, 0.45)';
    context.fillRect(fuelX - 4, barTop - 4, 26, barHeight + 8);
    const fuelColor = state.fuel > 50 ? '#58c96b' : state.fuel > 20 ? PALETTE.hudWarn : PALETTE.hudDanger;
    context.fillStyle = fuelColor;
    context.fillRect(fuelX, barTop + barHeight * (1 - state.fuel / 100), 18, barHeight * (state.fuel / 100));
    text('FUEL', fuelX + 9, barTop + barHeight + 10, 14, PALETTE.hudDim, 'center');
    const dmgTop = barTop + barHeight + 44;
    context.fillStyle = 'rgba(10, 16, 32, 0.45)';
    context.fillRect(fuelX - 4, dmgTop - 4, 26, 66);
    context.fillStyle = state.damage > 60 ? PALETTE.hudDanger : PALETTE.hudWarn;
    context.fillRect(fuelX, dmgTop + 58 * (1 - state.damage / 100), 18, 58 * (state.damage / 100));
    text('DMG', fuelX + 9, dmgTop + 66, 14, PALETTE.hudDim, 'center');
    // Attitude indicator, bottom left.
    const aiX = 78;
    const aiY = FIELD.height - 78;
    const aiR = 46;
    context.save();
    context.beginPath();
    context.arc(aiX, aiY, aiR, 0, Math.PI * 2);
    context.clip();
    context.translate(aiX, aiY);
    context.rotate(-plane.roll);
    context.translate(0, plane.pitch * 90);
    context.fillStyle = '#3f7fc4';
    context.fillRect(-aiR, -aiR * 2, aiR * 2, aiR * 2);
    context.fillStyle = '#7a5a38';
    context.fillRect(-aiR, 0, aiR * 2, aiR * 2);
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-aiR, 0);
    context.lineTo(aiR, 0);
    context.stroke();
    context.restore();
    context.strokeStyle = PALETTE.hud;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(aiX, aiY, aiR, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = PALETTE.hud;
    context.beginPath();
    context.arc(aiX, aiY, 3, 0, Math.PI * 2);
    context.fill();
    // Objective line, bottom centre.
    let objective = '';
    if (state.phase === 'ground') objective = 'TAKE OFF — hold SHIFT, pull up past 70 KT';
    else if (state.phase === 'landed') objective = 'ROLLING OUT — hold B to brake';
    else if (state.phase === 'complete') objective = 'MISSION COMPLETE';
    else if (state.phase === 'crashed') objective = 'CRASHED';
    else if (state.nextRing < COURSE.rings) {
      const ring = state.rings[state.nextRing];
      const distance = Math.round(Math.hypot(ring.x - plane.x, ring.y - plane.y, ring.z - plane.z));
      objective = `FLY RING ${state.nextRing + 1}/${COURSE.rings} — ${distance} m`;
    } else {
      objective = 'LAND — far runway, throttle back, flare gently';
    }
    text(objective, CENTER_X, FIELD.height - 34, 19, PALETTE.hud, 'center');
    // Transient message.
    if (state.message && state.elapsed < state.messageUntil) {
      text(state.message, CENTER_X, 150, 24, PALETTE.hudWarn, 'center');
    }
    // Warnings.
    const warnings = [];
    if (state.phase === 'flying' && state.fuel < 20 && state.fuel > 0) warnings.push('LOW FUEL');
    if (state.phase === 'flying' && plane.speed < PLANE.stallSpeed) warnings.push('STALL');
    if (state.phase === 'flying') {
      const clearance = plane.y - terrainHeight(plane.x, plane.z, state.seed);
      if (clearance < 25 && state.verticalSpeed < 0) warnings.push('PULL UP');
    }
    if (warnings.length > 0 && Math.floor(state.elapsed * 2) % 2 === 0) {
      text(warnings.join('  ·  '), CENTER_X, 182, 24, PALETTE.hudDanger, 'center');
    }
    context.restore();
  }

  function drawPanel(title, lines, prompt) {
    const width = 640;
    const lineHeight = 32;
    const height = 150 + lines.length * lineHeight + 64;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2;
    context.save();
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    context.fillStyle = 'rgba(8, 12, 24, 0.35)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    context.fillStyle = PALETTE.panel;
    context.fillRect(x, y, width, height);
    context.strokeStyle = PALETTE.hudDim;
    context.lineWidth = 1;
    context.strokeRect(x, y, width, height);
    context.textBaseline = 'alphabetic';
    text(title, FIELD.width / 2, y + 76, 46, PALETTE.text, 'center');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + 132 + index * lineHeight, 21, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 36, 23, PALETTE.ring, 'center');
    context.restore();
  }

  /**
   * The title screen's banner: a translucent strip across the top with the name, the
   * mission and the controls, leaving the jet and the valley visible below it.
   */
  function drawTitleBanner() {
    context.save();
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    context.fillStyle = 'rgba(8, 12, 24, 0.5)';
    context.fillRect(0, 24, FIELD.width, 266);
    context.textBaseline = 'alphabetic';
    text('RIDGE RUNNER', FIELD.width / 2, 100, 62, PALETTE.text, 'center');
    text('Take off, thread all 8 gold rings, then land on the far runway.', FIELD.width / 2, 152, 22, PALETTE.text, 'center');
    text('Watch the fuel — a soft, centred touchdown pays best.', FIELD.width / 2, 184, 22, PALETTE.muted, 'center');
    text('↑ ↓ or W S pitch · ← → or A D bank · SHIFT / CTRL throttle · mouse steers · B brake · P pause', FIELD.width / 2, 232, 19, PALETTE.hudDim, 'center');
    text('Press SPACE or click to fly', FIELD.width / 2, 272, 24, PALETTE.ring, 'center');
    context.restore();
  }

  /** Paint one frame: the world, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, best) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawWorld(state);
    if (screen === SCREEN_TITLE) {
      drawTitleBanner();
      return;
    }
    if (screen === SCREEN_PAUSED) {
      drawHud(state, screen, best);
      drawPanel('PAUSED', ['The valley will wait for you.'], 'Press P or SPACE to keep flying');
      return;
    }
    if (screen === SCREEN_OVER) {
      drawHud(state, screen, best);
      if (state.phase === 'complete' && state.landing) {
        drawPanel(
          'MISSION COMPLETE',
          [
            `Rings flown: ${state.ringsPassed}/${COURSE.rings} — ${state.ringsPassed * 250} points`,
            `Landing: base 400 · soft +${state.landing.soft} · centreline +${state.landing.line}`,
            `Fuel left +${state.landing.fuelBonus} · time +${state.landing.timeBonus}`,
            `SCORE ${state.score.toLocaleString('en-US')}   ·   BEST ${Math.max(best, state.score).toLocaleString('en-US')}`,
          ],
          'Press R or SPACE to fly again',
        );
      } else {
        const reason = state.crashReason || 'out of the sky';
        drawPanel(
          'CRASHED',
          [
            `You ${reason}.`,
            `Rings flown: ${state.ringsPassed}/${COURSE.rings}`,
            `SCORE ${state.score.toLocaleString('en-US')}   ·   BEST ${best.toLocaleString('en-US')}`,
          ],
          'Press R or SPACE to fly again',
        );
      }
      return;
    }
    drawHud(state, screen, best);
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, resize };
}
