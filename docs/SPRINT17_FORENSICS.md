# SPRINT 17 FORENSICS — the "lost work" ledger (Phase 0)

Owner directive: *"root-cause the audio escalation return… a one-page lost-work
ledger — every Sprint 15/16 fix present or absent, with file:line receipts."*

## 1. Deployment truth

| Claim (from sprint 14–16 reports) | Reality in repo | Receipt |
| --- | --- | --- |
| Sprint 16 "IRONHOLD" shipped as commit `e7e5822` | **Commit does not exist.** Reflog + `git cat-file` confirm | `git cat-file -t e7e5822` → `fatal: Not a valid object name` |
| Sprints 14–16 committed | **Never committed.** Last real commit was Sprint 13 | `git log` head = `91b4b1f` (sprint 13) before baseline `52f67c0` |
| CHANGELOG entries for 14–16 | **Absent.** Newest entry is Sprint 13 | `CHANGELOG.md` head |
| `.qa/sprint16/` receipts | **Absent** from this tree | `.qa/` listing |

**Root cause of the "lost work" cycle:** sprint 14–16 edits were applied
directly to the working tree across sessions with no commit step. Any session
that re-edited a file could silently overwrite a previous session's fix with a
stale in-memory version. This is why a *fixed* bug "came back": the fix existed
only in an uncommitted file that was later replaced wholesale. Fix: every sprint
now ends in an atomic commit; reports must cite a hash that `git cat-file`
resolves.

## 2. The audio escalation — root cause found (file:line)

The "music that keeps getting louder and never stops" is the **danger drone**:

1. **It escalates with wave pressure.** `src/game/engine.ts:645` drives
   `audio.setDanger(1 - Math.min(1, nearest / 16))` every frame. As waves
   thicken, foes crowd the ember, `nearest` shrinks, danger → 1 and the drone
   gain doubles (`0.05 → 0.10`, `src/game/audio.ts:190`).
2. **It never resets.** `setDanger()` is only called from the *playing* branch
   of the frame loop. On death / pause / reward / title the last value persists
   forever — the loop never writes `0`. Receipt: the only call site is
   engine.ts:645; `abandon()` (engine.ts:325), `onDeath` (engine.ts:516) and
   `startRun` (engine.ts:173) never touch it.
3. **The earlier "fix" never addressed the mechanism.** The inherited
   `afterglow/audio.ts:59` has a `DANGER_PERIOD` 4 Hz spam guard — a call-rate
   limiter, not a level fix. The level mechanism above survived untouched, and
   since none of it was committed, even that guard's history is unverifiable.

**Sprint 17 kill chain (belt + suspenders):** (a) engine writes
`setDanger(0)` on every phase transition — startRun / pause / abandon / death;
(b) `AudioEngine.tick(dt)` runs every frame in every phase and hard-decays the
danger layer if it has not been refreshed within 0.6 s (watchdog failsafe — no
suppression state can outlive its driver); (c) danger no longer scales raw
gain — it opens a filter and adds a pentatonic arp layer, so pressure reads as
*music brightening*, not a swelling air-conditioner hum; drone gain is clamped
to a hard ceiling.

## 3. Sprint 15/16 claims vs. inherited code

| Claim | Status | Receipt |
| --- | --- | --- |
| Weavers / casters / bulwarks / biome run structure / dawn economy | **PRESENT** (works) | `src/game/sim.ts:35,981-1109`, `src/game/run.ts` |
| "stun/slow ship as dormant kit" | **FALSE — zero CC code exists.** No stun/slow/root fields, triggers, or visuals anywhere in the sim | `grep -n 'stun\|slow\|root' src/game/sim.ts` → comments only; `Foe` interface sim.ts:83-109 has only `burn/burnT` |
| Determinism discipline ("zero rng in view paths") | **VIOLATED in sim** — weaver burst aim uses `Math.random()` | `src/game/sim.ts:995` `this.fireAt(f, (Math.random() - 0.5) * 0.18)` |
| `hitstopWarden 0.22` declared known-issue | Present, and **dead config**: `tryHitstop` clamps to `hitstopMax 0.16` | `src/game/constants.ts:148`, `src/game/engine.ts:539` |
| Fog / biome palettes / GLB biome dressing | Present | `src/game/constants.ts:127-131`, `src/game/scene.ts:718` |

## 4. Standing consequence (process law adopted)

- No sprint report ships without a resolvable commit hash + in-game build stamp.
- Inherited false claims are **declared at the top of the sprint report** (R3),
  buried nowhere.
- Sim determinism restored (`Math.random` → seeded `this.rng`) before any new
  sim code lands.
