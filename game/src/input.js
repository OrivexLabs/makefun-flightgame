// Keyboard and pointer input. Held keys steer; one-shot presses (start, pause, brake)
// are queued as bit flags and taken once by the loop, so a press between two frames is
// never lost and never counted twice. Moving the mouse steers too: the pointer's offset
// from the window centre is a stick deflection for a couple of seconds after it moves.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_RESTART = 4;
export const ACTION_MUTE = 8;

const PITCH_UP = new Set(['ArrowUp', 'KeyW']);
const PITCH_DOWN = new Set(['ArrowDown', 'KeyS']);
const ROLL_LEFT = new Set(['ArrowLeft', 'KeyA']);
const ROLL_RIGHT = new Set(['ArrowRight', 'KeyD']);
const THROTTLE_UP = new Set(['ShiftLeft', 'ShiftRight', 'Equal', 'NumpadAdd']);
const THROTTLE_DOWN = new Set(['ControlLeft', 'ControlRight', 'Minus', 'NumpadSubtract']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const RESTART = new Set(['KeyR']);
const MUTE = new Set(['KeyM']);
const BRAKE = new Set(['KeyB']);

export function createInput(target) {
  let pitchUp = false;
  let pitchDown = false;
  let rollLeft = false;
  let rollRight = false;
  let throttleUp = false;
  let throttleDown = false;
  let brake = false;
  let actions = 0;
  // Mouse stick: -1..1 in each axis, and when it was last moved.
  let mouseX = 0;
  let mouseY = 0;
  let mouseAt = -100;

  window.addEventListener('keydown', (event) => {
    if (PITCH_UP.has(event.code)) pitchUp = true;
    else if (PITCH_DOWN.has(event.code)) pitchDown = true;
    else if (ROLL_LEFT.has(event.code)) rollLeft = true;
    else if (ROLL_RIGHT.has(event.code)) rollRight = true;
    else if (THROTTLE_UP.has(event.code)) throttleUp = true;
    else if (THROTTLE_DOWN.has(event.code)) throttleDown = true;
    else if (BRAKE.has(event.code)) brake = true;
    else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (RESTART.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RESTART;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (PITCH_UP.has(event.code)) pitchUp = false;
    else if (PITCH_DOWN.has(event.code)) pitchDown = false;
    else if (ROLL_LEFT.has(event.code)) rollLeft = false;
    else if (ROLL_RIGHT.has(event.code)) rollRight = false;
    else if (THROTTLE_UP.has(event.code)) throttleUp = false;
    else if (THROTTLE_DOWN.has(event.code)) throttleDown = false;
    else if (BRAKE.has(event.code)) brake = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    pitchUp = false;
    pitchDown = false;
    rollLeft = false;
    rollRight = false;
    throttleUp = false;
    throttleDown = false;
    brake = false;
  });
  target.addEventListener('pointermove', (event) => {
    const rect = target.getBoundingClientRect();
    mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    mouseAt = performance.now() / 1000;
  });
  target.addEventListener('pointerdown', () => {
    actions |= ACTION_CONFIRM;
  });

  function mouseActive() {
    return performance.now() / 1000 - mouseAt < 2.5;
  }

  return {
    /** Pitch stick: -1 is nose down, 1 is nose up. */
    pitch() {
      if (pitchUp && !pitchDown) return 1;
      if (pitchDown && !pitchUp) return -1;
      if (mouseActive()) return Math.max(-1, Math.min(1, -mouseY * 1.4));
      return 0;
    },
    /** Roll stick: -1 is left, 1 is right. */
    roll() {
      if (rollLeft && !rollRight) return -1;
      if (rollRight && !rollLeft) return 1;
      if (mouseActive()) return Math.max(-1, Math.min(1, mouseX * 1.4));
      return 0;
    },
    /** Throttle lever: -1 is pull back, 1 is push forward. */
    throttle() {
      return (throttleUp ? 1 : 0) - (throttleDown ? 1 : 0);
    },
    brake() {
      return brake;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
