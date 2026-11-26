// Ridge Runner: every tuning number and colour in one place. The playfield is a fixed
// 1280x720 logical area; the renderer scales it to the window, so no rule below depends
// on the screen size. World units are metres; the HUD shows knots and feet.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** How many rings make one sortie, and where the course runs. */
export const COURSE = {
  rings: 8,
  firstRingZ: 900,
  ringSpacing: 430,
  ringRadius: 26,
  ringWeave: 130,
  ringBaseHeight: 95,
  ringHeightSwing: 30,
};

/** The two runways: takeoff (z 0..1200) and landing (z 4200..5400), both on x = 0. */
export const RUNWAY = {
  halfWidth: 20,
  takeoff: { z0: 0, z1: 1200 },
  landing: { z0: 4200, z1: 5400 },
};

/** The aircraft's flight envelope. Speeds are m/s; 1 m/s is about 1.94 knots. */
export const PLANE = {
  maxSpeed: 95,
  stallSpeed: 26,
  accel: 10,
  decel: 16,
  brakeDecel: 22,
  maxRoll: 1.05,
  rollRate: 2.4,
  maxPitch: 0.45,
  pitchRate: 1.7,
  climbPitch: 0.16,
  /** Seconds of fuel at full throttle, roughly; cruise throttle stretches it. */
  fuelSeconds: 300,
  /** Touchdown limits: sink faster, roll more, or land faster than these and it is a crash. */
  maxSink: 7,
  maxLandingSpeed: 60,
  maxLandingRoll: 0.3,
};

/** Scoring. */
export const SCORE = {
  ring: 250,
  landingBase: 400,
  landingSoftMax: 200,
  landingLineMax: 100,
  fuelPerPoint: 3,
  timeParSeconds: 300,
  timePerSecond: 2,
};

/** The camera: how far behind and above the jet the chase camera sits. */
export const CAMERA = { behind: 22, above: 7, fovDegrees: 70 };

/** Terrain drawing: how far ahead the grid reaches and how fine it is. */
export const TERRAIN = { ahead: 450, step: 15, halfWidth: 260, stepX: 20 };

export const PALETTE = {
  backdrop: '#0b1020',
  skyTop: '#274b7a',
  skyMid: '#7fb2dd',
  skyLow: '#cfe8f5',
  haze: '#b8d2e4',
  ridgeFar: '#7d9bb8',
  ridgeNear: '#5d7f9e',
  sun: '#fff3c4',
  grass: '#5e8f4e',
  scrub: '#7a8a4a',
  rock: '#8a6f5c',
  snow: '#e8eef2',
  sand: '#c2a878',
  water: '#3f7fb8',
  asphalt: '#33373d',
  runwayLine: '#e8e8e8',
  ring: '#ffb52e',
  ringGlow: '#ff8c1a',
  jetBody: '#c8d2dc',
  jetDark: '#5a6b7d',
  jetAccent: '#e8543f',
  afterburner: '#ff9a2e',
  hud: '#eaf6ff',
  hudDim: '#9fc3dd',
  hudWarn: '#ffb52e',
  hudDanger: '#ff5a4a',
  panel: '#101827',
  text: '#eef1f5',
  muted: '#93a3b5',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'ridge-runner.best';
