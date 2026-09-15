"""HOLLOW SUN — forge_anim_hound: Sprint 19-b "LIVING FOES". Rebuilds the
CINDER HOUND through the EXACT forge_hound.py (Task 15) recipe — mesh-building
helpers + build_cinder_hound copied verbatim, same seed default, same RNG
consumption order — so the silhouette is byte-for-byte the static asset, then
makes it ALIVE:

    - ARMATURE: 4 bones (root, spine, head, jaw), chained along the body axis
      (all bones point toward the snout = Blender -Y, roll 0, so every
      parent-relative rest rotation is identity and keyframes below conjugate
      cleanly into bone-local space).
    - AUTOMATIC PROXIMITY SKINNING: per-vertex weights = 1/d^3 against each
      bone's rest segment (top-2 kept, normalized) -> vertex groups + armature
      modifier. No mesh geometry is touched: tri count stays at the Task-15
      recipe count.
    - NLA-READY ACTIONS, all IN-PLACE (root keys never move x/y — the sim
      drives world position; only vertical z offsets, which are pose, not
      locomotion). Scene fps = 100 so every spec duration lands on an exact
      frame count. First key of every action is the identity (rest) pose so
      runtime crossfades blend from any state.

      prowl_idle     1.6s (161 frames, loop)  — low body bob + head sway/jaw slack
      windup         0.7s ( 71 frames)        — coil/crouch, weight back, snarl (HOUND.windupTime 0.7)
      charge_lunge   0.45s( 46 frames)        — stretched strike, bite open (HOUND.dashTime 0.45)
      recover        0.8s ( 81 frames)        — staggered recoil wobble (HOUND.recoverTime 0.8)
      death_collapse 0.5s ( 51 frames)        — drop + roll over + flatten (non-loop)

    Export replaces public/assets/meshes/cinder_hound.glb in place, same
    conventions as forge_hound.py: +Z build (centered, husk_drifter
    convention), glTF exporter's default +Y-up conversion. Geometry-only
    (no materials) — the runtime shader material keeps applying.

Run:
    blender -b -P scripts/blender/forge_anim_hound.py -- out public/assets/meshes

Arguments (after `--`):
    out DIR        output directory for .glb files (default: public/assets/meshes)
    --seed N       override the fixed seed (default 42 — the Task-15 recipe seed)
"""
import bpy
import bmesh
import math
import os
import random
import sys

from mathutils import Matrix, Vector, Quaternion

# ---------------------------------------------------------------- CLI args --
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg_value(*flags, default=None):
    for f in flags:
        if f in argv:
            i = argv.index(f)
            if i + 1 < len(argv):
                return argv[i + 1]
    return default


OUT_DIR = arg_value("out", "--out", default="public/assets/meshes")
SEED = int(arg_value("--seed", default="42"))
RNG = random.Random(SEED)

os.makedirs(OUT_DIR, exist_ok=True)

# tri budget = Task-15 recipe count (576) +10%
BUDGETS = {"cinder_hound": 633}

FPS = 100  # exact frames for every spec duration


# ----------------------------------------------------------------- helpers --
# ==================== VERBATIM RECIPE (scripts/blender/forge_hound.py) ======
# Copied unchanged so the hound silhouette is IDENTICAL to the static asset.

def flat(obj):
    for p in obj.data.polygons:
        p.use_smooth = False


def apply_mods(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def bevel(obj, width, segments=2):
    bev = obj.modifiers.new("bevel", "BEVEL")
    bev.width = width
    bev.segments = segments
    apply_mods(obj)
    flat(obj)


def tri_count(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def fit_dims(obj, target_h, target_w=None, anchor="base"):
    """Normalize to spec — uniform Z (height) scale, absolute X/Y footprint
    scale, then re-anchor. anchor="center" = bbox center at the origin
    (foe-body convention, matches husk_drifter)."""
    apply_mods(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    def bbox():
        bpy.context.view_layer.update()  # bound_box is lazy — force refresh
        lo = Vector((min(c[i] for c in obj.bound_box) for i in range(3)))
        hi = Vector((max(c[i] for c in obj.bound_box) for i in range(3)))
        return lo, hi, hi - lo

    lo, hi, size = bbox()
    s_h = target_h / max(size.z, 1e-6)
    s_w = 1.0
    if target_w:
        s_w = target_w / max(max(size.x, size.y), 1e-6)
    obj.scale = (s_w, s_w, s_h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    lo, hi, size = bbox()
    if anchor == "base":
        off = Vector((-(lo.x + hi.x) / 2.0, -(lo.y + hi.y) / 2.0, -lo.z))
    else:
        off = Vector(((-(lo.x + hi.x) / 2.0, -(lo.y + hi.y) / 2.0,
                       -(lo.z + hi.z) / 2.0)))
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.translate(bm, vec=off, verts=bm.verts)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

    lo, hi, size = bbox()
    print(f"FORGE_FIT {obj.name} h={size.z:.3f} w={max(size.x, size.y):.3f} "
          f"anchor={anchor} x=[{lo.x:.3f}..{hi.x:.3f}] "
          f"y=[{lo.y:.3f}..{hi.y:.3f}] z=[{lo.z:.3f}..{hi.z:.3f}]")


def ring_stack_y(bm, profile, sides=6, jitter=0.0, rng=None, phase=0.0):
    """HORIZONTAL ring stack for the hound: rings lie in the XZ plane and
    bridge along **Y** (rear +Y -> snout -Y). profile: list of
    (y, radius, cx, cz, twist). Per-vertex radius jitter + progressive twist
    = the gnarled/chiseled read. Both ends capped."""
    rings = []
    for (y, r, cx, cz, tw) in profile:
        ring = []
        for k in range(sides):
            a = phase + tw + math.pi * 2.0 * k / sides
            jr = r * (1.0 + (rng.uniform(-jitter, jitter) if rng and jitter else 0.0))
            ring.append(bm.verts.new((cx + math.cos(a) * jr,
                                      y,
                                      cz + math.sin(a) * jr)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((rings[i][k], rings[i][k2],
                          rings[i + 1][k2], rings[i + 1][k]))
    bm.faces.new(rings[-1])                   # snout cap (-Y end)
    bm.faces.new(tuple(reversed(rings[0])))   # rear cap (+Y end)
    return rings


def add_shard(bm, pos, r, h, tilt, yaw, rng):
    """4-sided predatory spike (quad base ring + apex), same as
    forge_library.py: built along local +Z, tilted toward +Y by `tilt`,
    yawed around Z, placed at `pos`. ~6 tris."""
    before = set(bm.verts)
    ring = []
    for i in range(4):
        a = math.pi / 4.0 + math.pi / 2.0 * i + rng.uniform(-0.14, 0.14)
        ring.append(bm.verts.new((math.cos(a) * r * rng.uniform(0.85, 1.15),
                                  math.sin(a) * r * rng.uniform(0.85, 1.15),
                                  rng.uniform(-0.02, 0.02))))
    apex = bm.verts.new((0.0, 0.0, h))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((ring[i], ring[j], apex))
    bm.faces.new(tuple(reversed(ring)))       # base cap (buried in the hull)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    verts = [v for v in bm.verts if v not in before]
    mat = (Matrix.Translation(pos)
           @ Matrix.Rotation(yaw, 4, "Z")
           @ Matrix.Rotation(tilt, 4, "X"))
    bmesh.ops.transform(bm, matrix=mat, verts=verts)


def add_leg(bm, pos, r, length, lean, yaw, rng):
    """Hound leg: 4-sided tapered prism running DOWN (local -Z) from a hip
    buried inside the hull, leaning outward by `lean`, aimed by `yaw`.
    ~8 tris."""
    before = set(bm.verts)
    rings = []
    a0 = rng.uniform(0.0, math.pi)
    for (t, rr) in ((0.0, r), (1.0, r * 0.55)):
        ring = []
        for k in range(4):
            a = a0 + math.pi / 2.0 * k
            ring.append(bm.verts.new((math.cos(a) * rr,
                                      math.sin(a) * rr,
                                      -t * length)))
        rings.append(ring)
    for k in range(4):
        k2 = (k + 1) % 4
        bm.faces.new((rings[0][k], rings[0][k2], rings[1][k2], rings[1][k]))
    bm.faces.new(tuple(reversed(rings[1])))  # paw cap
    bm.faces.new(rings[0])                   # hip cap (buried in the hull)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    verts = [v for v in bm.verts if v not in before]
    mat = (Matrix.Translation(pos)
           @ Matrix.Rotation(yaw, 4, "Z")
           @ Matrix.Rotation(lean, 4, "X"))
    bmesh.ops.transform(bm, matrix=mat, verts=verts)


# ------------------------------------------------------------- asset build --

def build_cinder_hound(coll):
    """CINDER HOUND — lean crouched quadruped wedge: horizontal 8-ring body
    stacking rear(+Y, haunch) -> snout(-Y), centerline descending forward
    (pounce pose), 4 buried legs, blade tail, 4 spine ember-crack plates,
    2 ears. One bmesh, overlapping solids (spike bases buried in the hull)."""
    mesh = bpy.data.meshes.new("cinder_hound")
    bm = bmesh.new()
    # body profile: (y, radius, cx, cz, twist) — cz DROPS toward the snout
    profile = [
        (1.18, 0.10, 0.00, 0.52, 0.00),   # tail root stub, raised rear
        (0.98, 0.34, 0.00, 0.44, 0.22),   # haunch
        (0.48, 0.46, 0.00, 0.34, 0.45),   # hips — widest band
        (-0.05, 0.40, 0.00, 0.24, 0.68),  # loin
        (-0.58, 0.34, 0.00, 0.18, 0.92),  # shoulder
        (-0.98, 0.21, 0.00, 0.16, 1.12),  # neck
        (-1.24, 0.11, 0.00, 0.20, 1.28),  # snout base
        (-1.42, 0.05, 0.00, 0.24, 1.38),  # nose tip
    ]
    ring_stack_y(bm, profile, sides=6, jitter=0.10, rng=RNG)
    # 4 legs — hips buried in the hull underside, slight outward lean
    for (ly, lx, yaw) in ((0.62, 0.24, math.pi / 2), (0.62, -0.24, -math.pi / 2),
                          (-0.52, 0.22, math.pi / 2), (-0.52, -0.22, -math.pi / 2)):
        add_leg(bm, (lx, ly, 0.10), 0.10, 0.42, 0.16, yaw, RNG)
    # blade tail — sweeps up and back off the raised rear
    add_shard(bm, (0.00, 1.06, 0.58), 0.09, 0.62, 0.85, 0.0, RNG)
    # spine ember-crack plates — thin predatory crest along the back
    for (sy, sh) in ((0.42, 0.42), (-0.24, 0.38), (-0.86, 0.26)):
        add_shard(bm, (0.00, sy, 0.62), 0.05, sh, -0.28, 0.0, RNG)
    # ears — two swept-back spikes at the snout base
    add_shard(bm, (0.11, -0.86, 0.34), 0.05, 0.24, -0.5, 0.18, RNG)
    add_shard(bm, (-0.11, -0.86, 0.34), 0.05, 0.24, -0.5, -0.18, RNG)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("cinder_hound", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.020, 1)
    fit_dims(obj, 2.0, 2.6, anchor="center")
    return obj


# ===================== END VERBATIM RECIPE ==================================


# ----------------------------------------------------------- rig builders --

def mesh_bbox(obj):
    bpy.context.view_layer.update()
    lo = Vector((min(c[i] for c in obj.bound_box) for i in range(3)))
    hi = Vector((max(c[i] for c in obj.bound_box) for i in range(3)))
    return lo, hi


def build_hound_armature(coll, mesh_obj):
    """4-bone chain along the body axis (rear +Y -> snout -Y), roll 0:
    root (haunch/pelvis) -> spine (loin..shoulder) -> head (snout) -> jaw.
    Bone segments derive from the MEASURED post-fit bbox so the rig tracks
    the recipe geometry, not hardcoded numbers."""
    lo, hi = mesh_bbox(mesh_obj)
    mid = (lo.y + hi.y) / 2.0
    L = (hi.y - lo.y) / 2.0
    h = hi.z - lo.z
    z_body = lo.z + 0.62 * h   # body rides high: legs hang below
    z_neck = lo.z + 0.58 * h
    z_head = lo.z + 0.68 * h
    z_jaw = lo.z + 0.56 * h

    arm = bpy.data.armatures.new("cinder_hound_rig")
    arm_obj = bpy.data.objects.new("cinder_hound_rig", arm)
    coll.objects.link(arm_obj)
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    def bone(name, head, tail, parent=None):
        e = arm.edit_bones.new(name)
        e.head, e.tail = Vector(head), Vector(tail)
        e.roll = 0.0
        e.use_connect = False  # independent loc offsets never tear (loc keys on root only)
        if parent:
            e.parent = parent
        return e

    b_root = bone("root", (mid + 0.35 * L, 0.0, z_body), (mid + 0.05 * L, 0.0, z_body))
    b_spine = bone("spine", (mid + 0.05 * L, 0.0, z_neck), (mid - 0.40 * L, 0.0, z_neck), b_root)
    b_head = bone("head", (mid - 0.40 * L, 0.0, z_head), (mid - 0.72 * L, 0.0, z_head), b_spine)
    bone("jaw", (mid - 0.58 * L, 0.0, z_jaw), (mid - 0.92 * L, 0.0, z_jaw), b_head)
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def proximity_skin(mesh_obj, arm_obj, segments, keep_top=2):
    """Automatic skinning: weight each vertex by 1/(d^3+eps) to every bone's
    rest SEGMENT (armature space), keep the `keep_top` strongest, normalize.
    No geometry edits — pure vertex-group writes."""
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    mod = mesh_obj.modifiers.new("armature", "ARMATURE")
    mod.object = arm_obj
    mesh_obj.parent = arm_obj

    mesh = mesh_obj.data
    mesh.update()
    bones = list(arm_obj.data.bones)
    segs = []
    for b in bones:
        a, c = segments[b.name]
        segs.append((b.name, Vector(a), Vector(c)))

    names = [b.name for b in bones]
    groups = {n: mesh_obj.vertex_groups.new(name=n) for n in names}
    wlists = []
    for v in mesh.vertices:
        p = v.co
        ws = []
        for (n, a, c) in segs:
            ab = c - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
            d = (p - (a + ab * t)).length
            ws.append((1.0 / (d * d * d + 1e-5), n))
        ws.sort(reverse=True)
        top = ws[:keep_top]
        s = sum(w for w, _ in top) or 1.0
        wlists.append([(n, w / s) for w, n in top])
    for vi, wl in enumerate(wlists):
        for n, w in wl:
            groups[n].add([vi], w, "REPLACE")
    print(f"FORGE_SKIN {mesh_obj.name} bones={names} verts={len(mesh.vertices)}")


# ------------------------------------------------------------- keyframing --
# Keyframe data is authored in ARMATURE (world) space and conjugated into
# bone-local space with the measured rest rotations — no axis guessing.

def rest_rel_rotations(arm_obj):
    """q_rest_rel[bone] = parent-rest-rotation^-1 * bone-rest-rotation
    (armature space). With every hound bone pointing -Y these are identity
    for children and the shared align rotation for root — computed, not
    assumed."""
    out = {}
    for pb in arm_obj.pose.bones:
        me = pb.bone.matrix_local.to_quaternion()
        if pb.parent is not None:
            par = pb.parent.bone.matrix_local.to_quaternion()
            out[pb.name] = par.inverted() @ me
        else:
            out[pb.name] = me
    return out


def _add_keys(fc, frames, values):
    fc.keyframe_points.add(count=len(frames))
    for kp, fr, va in zip(fc.keyframe_points, frames, values):
        kp.co = (float(fr), float(va))
        kp.interpolation = "BEZIER"
        kp.handle_left_type = "AUTO_CLAMPED"
        kp.handle_right_type = "AUTO_CLAMPED"
    fc.update()


def key_loc_world(act, arm_obj, bone, frames, world_offsets, qmap):
    """Pose-loc keys authored as WORLD deltas (root bone only — the in-place
    law: x/y stay 0, vertical bob/flatten only)."""
    q_align = arm_obj.pose.bones[bone].bone.matrix_local.to_quaternion()
    q_inv = q_align.inverted()
    comps = [[], [], []]
    for d in world_offsets:
        l = q_inv @ Vector(d)  # world delta -> bone-local axes
        for i in range(3):
            comps[i].append(l[i])
    for i in range(3):
        fc = act.fcurves.new(f'pose.bones["{bone}"].location', index=i)
        _add_keys(fc, frames, comps[i])


def key_rot_world(act, bone, frames, world_rots, qmap):
    """Pose-quat keys authored as WORLD-axis rotations applied to the rest
    pose: q_local = q_rest_rel^-1 * R_world * q_rest_rel."""
    q_rest = qmap[bone]
    q_inv = q_rest.inverted()
    comps = [[], [], [], []]
    for R in world_rots:
        q = (q_inv @ R @ q_rest)
        q.normalize()
        for i, v in enumerate((q.w, q.x, q.y, q.z)):
            comps[i].append(v)
    for i in range(4):
        fc = act.fcurves.new(f'pose.bones["{bone}"].rotation_quaternion', index=i)
        _add_keys(fc, frames, comps[i])


def make_action(name):
    act = bpy.data.actions.new(name)
    act.id_root = "OBJECT"
    return act


def rot(axis, angle):
    return Quaternion((axis[0], axis[1], axis[2]), angle)


ID = Quaternion((1.0, 0.0, 0.0), 0.0)  # identity


def build_hound_actions(arm_obj, qmap):
    """The five IN-PLACE actions. All root loc keys: x=0, y=0 (NO root
    motion law); first key of every action = identity rest pose."""
    acts = {}

    # --- prowl_idle 1.6s loop: low bob + head sway + jaw slack -------------
    a = make_action("prowl_idle")
    f = (1, 41, 81, 121, 160)
    key_loc_world(a, arm_obj, "root", f,
                  [(0, 0, 0), (0, 0, -0.045), (0, 0, 0), (0, 0, -0.045), (0, 0, 0)], qmap)
    key_rot_world(a, "spine", (1, 81, 160),
                  [rot((1, 0, 0), 0.04), rot((1, 0, 0), -0.04), rot((1, 0, 0), 0.04)], qmap)
    # head: yaw sway (Z) + counter-nod (X) — ONE fcurve set per channel, merged
    # on a shared frame list (two calls on the same path would double-fcurve)
    key_rot_world(a, "head", f,
                  [rot((0, 0, 1), 0.09) @ rot((1, 0, 0), -0.04),
                   rot((0, 0, 1), 0.00) @ rot((1, 0, 0), 0.04),
                   rot((0, 0, 1), -0.09) @ rot((1, 0, 0), -0.04),
                   rot((0, 0, 1), 0.00) @ rot((1, 0, 0), 0.04),
                   rot((0, 0, 1), 0.09) @ rot((1, 0, 0), -0.04)], qmap)
    key_rot_world(a, "jaw", (1, 81, 160),
                  [rot((1, 0, 0), 0.0), rot((1, 0, 0), 0.06), rot((1, 0, 0), 0.0)], qmap)
    acts["prowl_idle"] = a

    # --- windup 0.7s: coil/crouch, weight back, snarl (HOUND.windupTime) ---
    a = make_action("windup")
    f = (1, 36, 70)
    key_loc_world(a, arm_obj, "root", f, [(0, 0, 0), (0, 0, -0.20), (0, 0, -0.20)], qmap)
    key_rot_world(a, "spine", f,
                  [ID, rot((1, 0, 0), -0.12), rot((1, 0, 0), -0.12)], qmap)
    key_rot_world(a, "head", f,
                  [ID, rot((1, 0, 0), 0.20), rot((1, 0, 0), 0.20)], qmap)
    key_rot_world(a, "jaw", f,
                  [ID, rot((1, 0, 0), 0.12), rot((1, 0, 0), 0.12)], qmap)
    acts["windup"] = a

    # --- charge_lunge 0.45s: stretched strike, bite open (HOUND.dashTime) --
    a = make_action("charge_lunge")
    key_loc_world(a, arm_obj, "root", (1, 14, 32, 45),
                  [(0, 0, -0.16), (0, 0, 0.02), (0, 0, 0.10), (0, 0, 0.06)], qmap)
    key_rot_world(a, "spine", (1, 18, 45),
                  [rot((1, 0, 0), 0.10), rot((1, 0, 0), -0.18), rot((1, 0, 0), -0.22)], qmap)
    key_rot_world(a, "head", (1, 20, 45),
                  [rot((1, 0, 0), 0.18), rot((1, 0, 0), -0.06), rot((1, 0, 0), -0.02)], qmap)
    key_rot_world(a, "jaw", (1, 24, 45),
                  [rot((1, 0, 0), 0.10), rot((1, 0, 0), 0.42), rot((1, 0, 0), 0.30)], qmap)
    acts["charge_lunge"] = a

    # --- recover 0.8s: staggered recoil wobble (HOUND.recoverTime) ---------
    a = make_action("recover")
    key_loc_world(a, arm_obj, "root", (1, 14, 34, 58, 80),
                  [(0, 0, 0.06), (0, 0, -0.10), (0, 0, -0.04), (0, 0, -0.10), (0, 0, -0.02)], qmap)
    key_rot_world(a, "spine", (1, 18, 40, 80),
                  [rot((1, 0, 0), -0.22), rot((1, 0, 0), 0.06), rot((1, 0, 0), -0.04), ID], qmap)
    # head: nod (X) + shake (Z) merged on one shared frame list
    key_rot_world(a, "head", (1, 20, 46, 80),
                  [rot((0, 0, 1), 0.00) @ ID,
                   rot((0, 0, 1), 0.10) @ rot((1, 0, 0), 0.10),
                   rot((0, 0, 1), -0.06) @ rot((1, 0, 0), -0.03),
                   rot((0, 0, 1), 0.00) @ ID], qmap)
    key_rot_world(a, "jaw", (1, 30, 80),
                  [rot((1, 0, 0), 0.30), rot((1, 0, 0), 0.08), ID], qmap)
    acts["recover"] = a

    # --- death_collapse 0.5s non-loop: drop + roll over + flatten ----------
    a = make_action("death_collapse")
    key_loc_world(a, arm_obj, "root", (1, 10, 30, 50),
                  [(0, 0, 0), (0, 0, -0.15), (0, 0, -0.62), (0, 0, -0.66)], qmap)
    key_rot_world(a, "root", (1, 28, 50),
                  [ID, rot((0, 1, 0), 0.30), rot((0, 1, 0), 0.45)], qmap)
    key_rot_world(a, "spine", (1, 50), [ID, rot((1, 0, 0), 0.15)], qmap)
    key_rot_world(a, "head", (1, 20, 50),
                  [ID, rot((1, 0, 0), 0.25), rot((1, 0, 0), 0.55)], qmap)
    key_rot_world(a, "jaw", (1, 30, 50),
                  [ID, rot((1, 0, 0), 0.20), rot((1, 0, 0), 0.05)], qmap)
    acts["death_collapse"] = a

    return acts


def stash_actions(arm_obj, acts):
    """Push every action to a MUTED NLA track named after the action — the
    exporter's ACTIONS mode picks stashed actions up as separate glTF
    animations and the rig stays NLA-ready in the .blend sense."""
    ad = arm_obj.animation_data_create()
    ad.action = None
    for name in ("prowl_idle", "windup", "charge_lunge", "recover", "death_collapse"):
        act = acts[name]
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name=name, start=int(act.frame_range[0]), action=act)
        strip.name = name
        track.mute = True
    print("FORGE_NLA tracks=" + ",".join(acts))


def pose_check(arm_obj, acts, qmap):
    """Self-check: evaluate two key poses and print the ARMATURE-space deltas
    so the receipt proves the conjugated keys move bones the intended way."""
    ad = arm_obj.animation_data_create()
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.render.fps_base = 1.0

    def rest_pos(name):
        return arm_obj.pose.bones[name].bone.matrix_local.to_translation()

    # windup end: root should DROP -0.20 in world z
    ad.action = acts["windup"]
    sc.frame_set(71)
    bpy.context.view_layer.update()
    d = arm_obj.pose.bones["root"].matrix.to_translation() - rest_pos("root")
    print(f"POSE_CHECK windup@71 root_delta=({d.x:+.3f},{d.y:+.3f},{d.z:+.3f}) expect z=-0.200")

    # prowl_idle mid: head should YAW +0.09 about world Z
    ad.action = acts["prowl_idle"]
    sc.frame_set(81)
    bpy.context.view_layer.update()
    pb = arm_obj.pose.bones["head"]
    v = (pb.matrix.to_translation() - pb.bone.matrix_local.to_translation())
    rest_axis = pb.bone.matrix_local.to_3x3() @ Vector((0.0, 1.0, 0.0))
    cur_axis = pb.matrix.to_3x3() @ Vector((0.0, 1.0, 0.0))
    ang = rest_axis.angle(cur_axis)
    print(f"POSE_CHECK idle@81 head_yaw={math.degrees(ang):.2f}deg expect~5.16 (0.09rad) "
          f"head_pos_delta=({v.x:+.3f},{v.y:+.3f},{v.z:+.3f})")
    ad.action = None
    sc.frame_set(1)


# --------------------------------------------------------------- the build --

bpy.ops.wm.read_factory_settings(use_empty=True)

scene = bpy.context.scene
scene.render.fps = FPS
scene.render.fps_base = 1.0

BUILDERS = [("cinder_hound", build_cinder_hound)]

built = {}
stats = {}
for name, build in BUILDERS:
    coll = bpy.data.collections.new(name)
    scene.collection.children.link(coll)
    obj = build(coll)
    built[name] = coll
    tris = tri_count(obj)
    stats[name] = (tris, len(obj.data.vertices))
    over = " TRI_OVER_BUDGET" if tris > BUDGETS[name] else ""
    print(f"FORGE_BUILD {name} tris={tris} verts={stats[name][1]} "
          f"budget={BUDGETS[name]}{over}")

# ---- rig: armature + proximity skin + actions (the LIVING FOES layer) ------
hound = bpy.data.objects["cinder_hound"]
arm = build_hound_armature(built["cinder_hound"], hound)

lo, hi = mesh_bbox(hound)
mid = (lo.y + hi.y) / 2.0
L = (hi.y - lo.y) / 2.0
h = hi.z - lo.z
zb = lo.z + 0.62 * h
zn = lo.z + 0.58 * h
zh = lo.z + 0.68 * h
zj = lo.z + 0.56 * h
SEGMENTS = {
    "root": ((mid + 0.35 * L, 0, zb), (mid + 0.05 * L, 0, zb)),
    "spine": ((mid + 0.05 * L, 0, zn), (mid - 0.40 * L, 0, zn)),
    "head": ((mid - 0.40 * L, 0, zh), (mid - 0.72 * L, 0, zh)),
    "jaw": ((mid - 0.58 * L, 0, zj), (mid - 0.92 * L, 0, zj)),
}
proximity_skin(hound, arm, SEGMENTS)

qmap = rest_rel_rotations(arm)
acts = build_hound_actions(arm, qmap)
pose_check(arm, acts, qmap)
stash_actions(arm, acts)

for name, (fr, to) in ((a.name, a.frame_range) for a in acts.values()):
    print(f"FORGE_ACTION {name} frames={int(fr)}..{int(to)} "
          f"dur={(to - fr + 1) / FPS:.2f}s fps={FPS}")

# ------------------------------------------------------------- the export --
names = [n for n, _ in BUILDERS if n in built]
for name in names:
    for child in list(scene.collection.children):
        scene.collection.children.unlink(child)
    scene.collection.children.link(built[name])
    bpy.context.view_layer.update()
    path = os.path.join(OUT_DIR, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB",
                              export_apply=True,
                              export_animation_mode="ACTIONS")
    tris, verts = stats[name]
    print(f"FORGE_ASSET_OK {name}.glb tris={tris} verts={verts} "
          f"bytes={os.path.getsize(path)}")

print(f"FORGE_DONE count={len(names)} out={OUT_DIR} seed={SEED} "
      f"actions=5 rig=root,spine,head,jaw")
