# makefun-flightgame

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/OrivexLabs/makefun-flightgame/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/OrivexLabs/makefun-flightgame/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

**Ridge Runner** — a canyon flight game. Take off from the valley runway, thread all 8 gold rings through a mountain valley with a winding river below, then turn back and land on the far runway. Throttle discipline matters: full throttle burns the tank, and a soft, centred touchdown pays best. Low flying scrapes the airframe, fuel runs out, and the valley sides do not forgive a lazy turn.

## Run it

```sh
node serve.ts
# then open http://localhost:8080
```

Play with keyboard or mouse: ↑ ↓ or W S to pitch, ← → or A D to bank and turn, SHIFT / CTRL for throttle, B for airbrake, mouse steers too (move it like a stick). P pauses, M mutes, R restarts. The HUD shows airspeed, altitude, heading tape, throttle, fuel, damage, an attitude indicator, and the next ring's distance. Screenshots are real renders of the game in a browser (title, mid-flight, final approach, crash).

## Layout

- `main.ts` — the make.fun hand-in: copies `game/` and `screenshots/` to `/output` and writes `dossier.json`.
- `game/` — the game itself, plain static files, no network requests: `index.html` plus `src/` (`config.js` tuning, `noise.js` seeded valley heightfield, `world.js` flight model and rules, `render.js` pseudo-3D chase view and HUD, `input.js`, `audio.js` synthesised sounds, `shots.js` screenshot scenes and autopilot, `main.js` loop).
- `screenshots/` — four real renders of the game in a browser (title, mid-flight, landing, crash).
- `shots.json` — the `?shot=` scenes behind the screenshots.

---

<sub>Entered on [make.fun](https://make.fun/?ref=silver-beacon-98-6815&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
