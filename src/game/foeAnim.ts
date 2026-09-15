import * as THREE from 'three';

/**
 * HOLLOW SUN — LIVING FOES (sprint 19-b).
 * Per-foe AnimationMixer pool driving the Blender-rigged GLB actions.
 *
 * The forge (scripts/blender/forge_anim_*.py) bakes in-place actions into
 * cinder_hound.glb (prowl_idle / windup / charge_lunge / recover /
 * death_collapse) and hex_weaver.glb (hover_idle / anchor_cast /
 * death_collapse). The sim drives position — the rigs only pose, so the
 * deterministic digest is untouched (view-layer law).
 *
 * SOFT-FAIL LAW: if a GLB arrives without its clips, register() returns
 * false and the view keeps the static mesh — a missing asset never breaks
 * the game, it only downgrades the silhouette (assetLib law).
 */

/** sim-state → action-name maps (state names match the sim FSM) */
export const ANIM_SETS = {
  hound: { idle: 'prowl_idle', windup: 'windup', charge: 'charge_lunge', recover: 'recover' },
  weaver: { idle: 'hover_idle', cast: 'anchor_cast' },
} as const;

export type AnimKind = keyof typeof ANIM_SETS;

interface Attach {
  mixer: THREE.AnimationMixer;
  byState: Record<string, THREE.AnimationAction | undefined>;
  current: string;
}

const ANIM_CAP = 24; // pool is 40 foes; hound+weaver seats in a room stay well under this

export class FoeAnimator {
  private clips = new Map<AnimKind, Map<string, THREE.AnimationClip>>();
  private entries = new Map<number, Attach>();

  /** register a kind's clips — true iff every state in its ANIM_SET exists */
  register(kind: AnimKind, clips: THREE.AnimationClip[]): boolean {
    const byName = new Map(clips.map((c) => [c.name, c]));
    const ok = Object.values(ANIM_SETS[kind]).every((n) => byName.has(n));
    this.clips.set(kind, byName);
    return ok;
  }

  has(kind: AnimKind): boolean {
    return this.clips.has(kind);
  }

  attach(id: number, root: THREE.Object3D, kind: AnimKind): void {
    const clips = this.clips.get(kind);
    if (!clips || this.entries.size >= ANIM_CAP || this.entries.has(id)) return;
    const mixer = new THREE.AnimationMixer(root);
    const byState: Record<string, THREE.AnimationAction | undefined> = {};
    for (const [state, clipName] of Object.entries(ANIM_SETS[kind])) {
      const clip = clips.get(clipName);
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      if (state !== 'idle') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true; // hold the coil / the lunge / the slump
      }
      byState[state] = action;
    }
    const idle = byState.idle;
    if (idle) idle.play();
    this.entries.set(id, { mixer, byState, current: 'idle' });
  }

  /** crossfade to a state — no-op when unknown (soft-fail law) */
  setState(id: number, state: string, fade = 0.14): void {
    const e = this.entries.get(id);
    if (!e || e.current === state) return;
    const next = e.byState[state];
    if (!next) return;
    const prev = e.byState[e.current];
    next.reset();
    if (prev && prev !== next) next.crossFadeFrom(prev, fade, false);
    next.play();
    e.current = state;
  }

  tick(dt: number): void {
    for (const e of this.entries.values()) e.mixer.update(dt);
  }

  detach(id: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.mixer.stopAllAction();
    this.entries.delete(id);
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.detach(id);
    this.clips.clear();
  }
}
