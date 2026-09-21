"""HOLLOW SUN — forge_anim_striker: Sprint 20-4b "LIVING FOES II". Rigs the
STRIKER DART through the EXACT forge_anim_hound.py (Task 19-b) recipe —
same seed default, same RNG consumption order, same helper structure, same
in-place action law — so the new foe ships with the proven pipeline:

    - SILHOUETTE: angular dart/manta wedge. Body axis along Y with the nose
      facing **-Y** (the hound/weaver snout-forward law). Elliptical rings
      (wide X, thin Z) bridge tail(+Y) -> nose(-Y); two swept wing bands
      (choir arc_band pattern) + tip spikes give the manta read; dorsal
      keel + twin tail fins + wing spikes keep it chiseled.

    - ARMATURE: 4 bones (root, spine, finL, finR), roll 0, measured from the
      post-fit mesh bbox. root/spine chain along the body axis (pointing
      -Y like the hound), finL/finR ride the wing bands (pointing +/-X —
      the weaver rim_tip precedent). Every parent-relative rest rotation
      is computed, never assumed (rest_rel_rotations).

    - AUTOMATIC PROXIMITY SKINNING: per-vertex weights = 1/d^3 against each
      bone's rest segment (top-2 kept, normalized) -> vertex groups +
      armature modifier. No mesh geometry is touched by the rig.

    - NLA-READY ACTIONS, all IN-PLACE (root keys never move x/y — the sim
      drives world position; only vertical z offsets, which are pose, not
      locomotion). Scene fps = 100 so every spec duration lands on an exact
      frame count. First key of the loop/windup actions is the identity
      (rest) pose so runtime crossfades blend from any state; the strike/
      recover one-shots chain from the held pose (hound law).

      coil_idle    1.60s (161 frames, loop) — low hover bob + fin sway/spine yaw
      windup       0.55s ( 56 frames)       — telegraph coil: drop + rear back + fins swept (striker windup scale)
      strike_lunge 0.35s ( 36 frames)       — stretched dart strike, fins snapped forward
      recover      0.70s ( 71 frames)       — staggered recoil wobble back to rest

    Export replaces public/assets/meshes/striker_dart.glb in place, same
    conventions as forge_anim_hound.py: foe-body anchor="center", glTF
    exporter's default +Y-up conversion, export_animation_mode="ACTIONS"
    over muted NLA stash tracks. Geometry-only (no materials) — the runtime
    shader material keeps applying.

Run:
    blender -b -P scripts/blender/forge_anim_striker.py -- out public/assets/meshes

Arguments (after `--`):
    out DIR        output directory for .glb files (default: public/assets/meshes)
    --seed N       override the fixed seed (default 42)
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

# tri budget = designed recipe count +10% headroom (20-4b contract: <= 600)
BUDGETS = {"striker_dart": 600}

FPS = 100  # exact frames for every spec duration


# ----------------------------------------------------------------- helpers --
# (same conventions as forge_anim_hound.py / forge_choir.py)

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
    (foe-body convention, matches husk_drifter/cinder_hound)."""
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


def dart_ring_y(bm, profile, sides=6, jitter=0.0, rng=None, phase=0.0):
    """HORIZONTAL elliptical ring stack for the dart: rings lie in the XZ
    plane and bridge along **Y** (tail +Y -> nose -Y, the hound law).
    profile: list of (y, rx, rz, cz, twist). Per-vertex radius jitter +
    progressive twist = the gnarled/chiseled read. Both ends capped."""
    rings = []
    for (y, rx, rz, cz, tw) in profile:
        ring = []
        for k in range(sides):
            a = phase + tw + math.pi * 2.0 * k / sides
            jr = 1.0 + (rng.uniform(-jitter, jitter) if rng and jitter else 0.0)
            ring.append(bm.verts.new((math.cos(a) * rx * jr,
                                      y,
                                      cz + math.sin(a) * rz * jr)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((rings[i][k], rings[i][k2],
                          rings[i + 1][k2], rings[i + 1][k]))
    bm.faces.new(rings[-1])                   # nose cap (-Y end)
    bm.faces.new(tuple(reversed(rings[0])))   # tail cap (+Y end)
    return rings


def wing_band(bm, path, sides=3, r0=0.15, r1=0.035, jitter=0.0, rng=None,
              twist0=0.0, twist1=1.1, phase=0.0):
    """Swept wing band along a 3D polyline `path` — the choir arc_band
    pattern: one n-gon ring per path station lying in the plane
    PERPENDICULAR to the local path tangent, radius lerped r0->r1 and twist
    accumulated twist0->twist1 around the tangent. Both ends capped."""
    rings = []
    ref = Vector((0.0, 0.0, 1.0))   # wing paths run horizontal — Z is always ⟂
    n = len(path)
    for i, p in enumerate(path):
        t = i / max(n - 1, 1)
        prev = path[max(i - 1, 0)]
        nxt = path[min(i + 1, n - 1)]
        tan = nxt - prev
        if tan.length < 1e-6:
            tan = Vector((1.0, 0.0, 0.0))
        tan.normalize()
        u = ref.cross(tan)           # ⟂ tangent (frame axis 1)
        if u.length < 1e-6:
            u = Vector((0.0, 1.0, 0.0))
        u.normalize()
        v = tan.cross(u)             # ⟂ tangent (frame axis 2)
        tw = twist0 + (twist1 - twist0) * t
        r = r0 + (r1 - r0) * t
        cu, su = math.cos(tw), math.sin(tw)
        u2 = u * cu + v * su         # frame rotated around the tangent
        v2 = v * cu - u * su
        ring = []
        for k in range(sides):
            a = phase + math.pi * 2.0 * k / sides
            jr = r * (1.0 + (rng.uniform(-jitter, jitter) if rng and jitter else 0.0))
            ring.append(bm.verts.new(p + u2 * (math.cos(a) * jr)
                                       + v2 * (math.sin(a) * jr)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((rings[i][k], rings[i][k2],
                          rings[i + 1][k2], rings[i + 1][k]))
    bm.faces.new(rings[-1])                   # path-end cap
    bm.faces.new(tuple(reversed(rings[0])))   # path-start cap
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


# ------------------------------------------------------------- asset build --

def build_striker_dart(coll):
    """STRIKER DART — angular manta wedge: elliptical 7-ring body stacking
    tail(+Y) -> nose(-Y), 2 swept wing bands with tip spikes, dorsal keel,
    twin tail fins. One bmesh, overlapping solids (spike bases buried)."""
    mesh = bpy.data.meshes.new("striker_dart")
    bm = bmesh.new()
    # body profile: (y, rx, rz, cz, twist) — nose at -Y (snout-forward law)
    profile = [
        (0.95, 0.10, 0.05, 0.05, 0.00),   # tail tip
        (0.55, 0.22, 0.10, 0.04, 0.25),   # tail
        (0.05, 0.42, 0.13, 0.00, 0.55),   # mid — wing root zone
        (-0.45, 0.38, 0.14, -0.02, 0.85),  # shoulders
        (-0.85, 0.24, 0.11, 0.00, 1.10),  # neck
        (-1.15, 0.10, 0.07, 0.04, 1.30),  # nose base
        (-1.30, 0.04, 0.04, 0.05, 1.40),  # nose tip
    ]
    dart_ring_y(bm, profile, sides=6, jitter=0.10, rng=RNG)
    # swept manta wings: body edge -> tip, swept BACK (+Y drift) + slight rise
    wing_band(bm, [Vector((0.30, -0.42, 0.02)),
                   Vector((0.85, -0.12, 0.05)),
                   Vector((1.40, 0.14, 0.09))],
              sides=3, r0=0.15, r1=0.035, jitter=0.08, rng=RNG,
              twist0=0.0, twist1=1.2)
    wing_band(bm, [Vector((-0.30, -0.42, 0.02)),
                   Vector((-0.85, -0.12, 0.05)),
                   Vector((-1.40, 0.14, 0.09))],
              sides=3, r0=0.15, r1=0.035, jitter=0.08, rng=RNG,
              twist0=0.0, twist1=1.2)
    # dorsal keel — swept-back blade on the spine
    add_shard(bm, (0.00, -0.35, 0.14), 0.05, 0.34, -0.30, 0.0, RNG)
    # twin tail fins
    add_shard(bm, (0.10, 0.72, 0.06), 0.045, 0.22, 0.50, -0.50, RNG)
    add_shard(bm, (-0.10, 0.72, 0.06), 0.045, 0.22, 0.50, 0.50, RNG)
    # wing tip spikes — points outward along +/-X (yaw maps the +Y tilt)
    add_shard(bm, (1.42, 0.16, 0.09), 0.05, 0.30, 0.30, -math.pi / 2, RNG)
    add_shard(bm, (-1.42, 0.16, 0.09), 0.05, 0.30, 0.30, math.pi / 2, RNG)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("striker_dart", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.016, 1)
    fit_dims(obj, 0.55, 3.0, anchor="center")
    return obj


# ----------------------------------------------------------- rig builders --

def mesh_bbox(obj):
    bpy.context.view_layer.update()
    lo = Vector((min(c[i] for c in obj.bound_box) for i in range(3)))
    hi = Vector((max(c[i] for c in obj.bound_box) for i in range(3)))
    return lo, hi


def build_striker_armature(coll, mesh_obj):
    """4 bones, roll 0, measured from the post-fit bbox: root (tail body)
    -> spine (mid..nose, both pointing -Y like the hound), finL/finR riding
    the wing bands (pointing +/-X, the weaver rim_tip precedent)."""
    lo, hi = mesh_bbox(mesh_obj)
    mid = (lo.y + hi.y) / 2.0
    L = (hi.y - lo.y) / 2.0
    h = hi.z - lo.z
    z_body = lo.z + 0.55 * h
    zm = (lo.z + hi.z) / 2.0
    rmax = max(abs(lo.x), abs(hi.x))

    arm = bpy.data.armatures.new("striker_dart_rig")
    arm_obj = bpy.data.objects.new("striker_dart_rig", arm)
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

    b_root = bone("root", (mid + 0.30 * L, 0.0, z_body), (mid - 0.05 * L, 0.0, z_body))
    b_spine = bone("spine", (mid - 0.05 * L, 0.0, z_body), (mid - 0.75 * L, 0.0, z_body), b_root)
    b_finl = bone("finL", (0.25 * rmax, -0.05, zm), (0.92 * rmax, 0.10, zm), b_spine)
    b_finr = bone("finR", (-0.25 * rmax, -0.05, zm), (-0.92 * rmax, 0.10, zm), b_spine)
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
    (armature space). Computed, not assumed — root/spine point -Y while
    finL/finR point +/-X, so the conjugation matters."""
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
    law: x/y stay 0, vertical bob only)."""
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


def build_striker_actions(arm_obj, qmap):
    """The four IN-PLACE actions. All root loc keys: x=0, y=0 (NO root
    motion law); loop/windup first key = identity rest pose; strike/recover
    chain from the held pose (hound law)."""
    acts = {}

    # --- coil_idle 1.6s loop: low hover bob + spine sway + fin flap --------
    a = make_action("coil_idle")
    f = (1, 41, 81, 121, 160)
    key_loc_world(a, arm_obj, "root", f,
                  [(0, 0, 0), (0, 0, -0.05), (0, 0, 0), (0, 0, -0.05), (0, 0, 0)], qmap)
    # spine: yaw sway (Z) + counter-nod (X) merged on one shared frame list
    key_rot_world(a, "spine", f,
                  [rot((0, 0, 1), 0.06) @ rot((1, 0, 0), 0.04),
                   rot((0, 0, 1), 0.00) @ rot((1, 0, 0), -0.04),
                   rot((0, 0, 1), -0.06) @ rot((1, 0, 0), 0.04),
                   rot((0, 0, 1), 0.00) @ rot((1, 0, 0), -0.04),
                   rot((0, 0, 1), 0.06) @ rot((1, 0, 0), 0.04)], qmap)
    # fins: lazy alternating flap about world Y (weaver rim flutter law)
    key_rot_world(a, "finL", f,
                  [rot((0, 1, 0), 0.14), rot((0, 1, 0), -0.10),
                   rot((0, 1, 0), 0.14), rot((0, 1, 0), -0.10),
                   rot((0, 1, 0), 0.14)], qmap)
    key_rot_world(a, "finR", f,
                  [rot((0, 1, 0), -0.14), rot((0, 1, 0), 0.10),
                   rot((0, 1, 0), -0.14), rot((0, 1, 0), 0.10),
                   rot((0, 1, 0), -0.14)], qmap)
    acts["coil_idle"] = a

    # --- windup 0.55s: telegraph coil — drop, rear back, fins swept back --
    a = make_action("windup")
    f = (1, 29, 56)
    key_loc_world(a, arm_obj, "root", f, [(0, 0, 0), (0, 0, -0.12), (0, 0, -0.12)], qmap)
    key_rot_world(a, "spine", f,
                  [ID, rot((1, 0, 0), -0.22), rot((1, 0, 0), -0.22)], qmap)
    key_rot_world(a, "finL", f,
                  [ID, rot((0, 0, 1), 0.35), rot((0, 0, 1), 0.35)], qmap)
    key_rot_world(a, "finR", f,
                  [ID, rot((0, 0, 1), -0.35), rot((0, 0, 1), -0.35)], qmap)
    acts["windup"] = a

    # --- strike_lunge 0.35s: stretched dart strike, fins snapped forward --
    a = make_action("strike_lunge")
    key_loc_world(a, arm_obj, "root", (1, 14, 36),
                  [(0, 0, -0.12), (0, 0, 0.02), (0, 0, 0.06)], qmap)
    key_rot_world(a, "spine", (1, 14, 36),
                  [rot((1, 0, 0), -0.22), rot((1, 0, 0), 0.30), rot((1, 0, 0), 0.22)], qmap)
    key_rot_world(a, "finL", (1, 14, 36),
                  [rot((0, 0, 1), 0.35), rot((0, 0, 1), -0.30), rot((0, 0, 1), -0.15)], qmap)
    key_rot_world(a, "finR", (1, 14, 36),
                  [rot((0, 0, 1), -0.35), rot((0, 0, 1), 0.30), rot((0, 0, 1), 0.15)], qmap)
    acts["strike_lunge"] = a

    # --- recover 0.7s: staggered recoil wobble back to rest ----------------
    a = make_action("recover")
    key_loc_world(a, arm_obj, "root", (1, 18, 42, 71),
                  [(0, 0, 0.06), (0, 0, -0.10), (0, 0, -0.04), (0, 0, 0)], qmap)
    key_rot_world(a, "spine", (1, 20, 46, 71),
                  [rot((1, 0, 0), 0.22), rot((1, 0, 0), -0.06), rot((1, 0, 0), 0.02), ID], qmap)
    key_rot_world(a, "finL", (1, 24, 71),
                  [rot((0, 0, 1), -0.15), rot((0, 0, 1), 0.06), ID], qmap)
    key_rot_world(a, "finR", (1, 24, 71),
                  [rot((0, 0, 1), 0.15), rot((0, 0, 1), -0.06), ID], qmap)
    acts["recover"] = a

    return acts


def stash_actions(arm_obj, acts):
    """Push every action to a MUTED NLA track named after the action — the
    exporter's ACTIONS mode picks stashed actions up as separate glTF
    animations and the rig stays NLA-ready in the .blend sense."""
    ad = arm_obj.animation_data_create()
    ad.action = None
    for name in ("coil_idle", "windup", "strike_lunge", "recover"):
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

    # windup end: root should DROP -0.12 in world z
    ad.action = acts["windup"]
    sc.frame_set(56)
    bpy.context.view_layer.update()
    d = arm_obj.pose.bones["root"].matrix.to_translation() - rest_pos("root")
    print(f"POSE_CHECK windup@56 root_delta=({d.x:+.3f},{d.y:+.3f},{d.z:+.3f}) expect z=-0.120")

    # coil_idle mid: spine should YAW -0.06 about world Z
    ad.action = acts["coil_idle"]
    sc.frame_set(81)
    bpy.context.view_layer.update()
    pb = arm_obj.pose.bones["spine"]
    rest_axis = pb.bone.matrix_local.to_3x3() @ Vector((0.0, 1.0, 0.0))
    cur_axis = pb.matrix.to_3x3() @ Vector((0.0, 1.0, 0.0))
    ang = rest_axis.angle(cur_axis)
    print(f"POSE_CHECK idle@81 spine_yaw={math.degrees(ang):.2f}deg expect~3.44 (0.06rad)")
    ad.action = None
    sc.frame_set(1)


# --------------------------------------------------------------- the build --

bpy.ops.wm.read_factory_settings(use_empty=True)

scene = bpy.context.scene
scene.render.fps = FPS
scene.render.fps_base = 1.0

BUILDERS = [("striker_dart", build_striker_dart)]

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
striker = bpy.data.objects["striker_dart"]
arm = build_striker_armature(built["striker_dart"], striker)

lo, hi = mesh_bbox(striker)
mid = (lo.y + hi.y) / 2.0
L = (hi.y - lo.y) / 2.0
h = hi.z - lo.z
zb = lo.z + 0.55 * h
zm = (lo.z + hi.z) / 2.0
rmax = max(abs(lo.x), abs(hi.x))
SEGMENTS = {
    "root": ((mid + 0.30 * L, 0, zb), (mid - 0.05 * L, 0, zb)),
    "spine": ((mid - 0.05 * L, 0, zb), (mid - 0.75 * L, 0, zb)),
    "finL": ((0.25 * rmax, -0.05, zm), (0.92 * rmax, 0.10, zm)),
    "finR": ((-0.25 * rmax, -0.05, zm), (-0.92 * rmax, 0.10, zm)),
}
proximity_skin(striker, arm, SEGMENTS)

qmap = rest_rel_rotations(arm)
acts = build_striker_actions(arm, qmap)
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
      f"actions=4 rig=root,spine,finL,finR")
