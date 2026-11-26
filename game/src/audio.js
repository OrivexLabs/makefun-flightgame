// Synthesised sound, nothing more: an engine hum that follows the throttle, a chime
// for each ring, a beep for warnings and a noise burst for a crash. Everything is
// guarded: no audio context, no sound, no failure.
export function createAudio() {
  let context = null;
  let engineOsc = null;
  let engineGain = null;
  let windGain = null;
  let muted = false;
  let started = false;

  function ensure() {
    if (context !== null) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(context.destination);
      engineOsc.start();
      const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
      const wind = context.createBufferSource();
      wind.buffer = buffer;
      wind.loop = true;
      const windFilter = context.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 480;
      windGain = context.createGain();
      windGain.gain.value = 0;
      wind.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(context.destination);
      wind.start();
      started = true;
      return true;
    } catch {
      context = null;
      return false;
    }
  }

  function beep(frequency, duration, type, gainValue, when) {
    if (!started || muted) return;
    try {
      const osc = context.createOscillator();
      osc.type = type ?? 'sine';
      osc.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, context.currentTime + when);
      gain.gain.linearRampToValueAtTime(gainValue, context.currentTime + when + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + when + duration);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(context.currentTime + when);
      osc.stop(context.currentTime + when + duration + 0.05);
    } catch {
      // Sound is garnish: never let it break the game.
    }
  }

  return {
    /** Call from a user gesture: browsers only allow audio after one. */
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
    },
    setMuted(value) {
      muted = value;
      if (engineGain) engineGain.gain.value = 0;
      if (windGain) windGain.gain.value = 0;
    },
    isMuted() {
      return muted;
    },
    /** Every frame while flying: throttle 0..1, speed m/s. */
    engine(throttle, speed) {
      if (!started || muted) return;
      try {
        engineOsc.frequency.value = 50 + throttle * 90 + speed * 0.35;
        engineGain.gain.value = 0.028 + throttle * 0.05;
        windGain.gain.value = Math.max(0, (speed - 30) / 90) * 0.05;
      } catch {
        // Ignore.
      }
    },
    ring() {
      beep(659, 0.18, 'sine', 0.16, 0);
      beep(988, 0.3, 'sine', 0.16, 0.09);
    },
    warning() {
      beep(440, 0.12, 'square', 0.05, 0);
    },
    land() {
      beep(523, 0.15, 'sine', 0.14, 0);
      beep(784, 0.25, 'sine', 0.14, 0.12);
    },
    crash() {
      if (!started || muted) return;
      try {
        const buffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let index = 0; index < data.length; index += 1) {
          data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = 0.3;
        source.connect(gain);
        gain.connect(context.destination);
        source.start();
        if (engineGain) engineGain.gain.value = 0;
        if (windGain) windGain.gain.value = 0;
      } catch {
        // Ignore.
      }
    },
  };
}
