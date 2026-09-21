"""HOLLOW SUN — forge_anim_bulwark: Sprint 20-4b "LIVING FOES II". Rigs the
BULWARK SLAB through the EXACT forge_anim_hound.py (Task 19-b) recipe —
same seed default, same RNG consumption order, same helper structure, same
in-place action law:

    - SILHOUETTE: heavy sentinel slab. Vertical +Z build (foe-body
      anchor="center" like hound/weaver — the runtime recenter owns the
      floor), forward face toward **-Y** (the snout-forward law, read by
      the visor bar). Hex slab torso with wind-sheared taper, 2 stub legs,
      2 angular shoulder plates + plate spikes, brow visor.

    - ARMATURE: 4 bones (root, torso, plateL, plateR), roll 0, measured
      from the post-fit mesh bbox. root/torso chain up the axis (+Z, the
      weaver root/bell precedent), plateL/plateR ride the shoulder plates
      (pointing outward +/-X with a slight rise).

    - AUTOMATIC PROXIMITY SKINNING: per-vertex weights = 1/d^3 against each
      bone's rest segment (top-2 kept, normalized) -> vertex groups +
      armature modifier. No mesh geometry is touched by the rig.

    - NLA-READY ACTIONS, all IN-PLACE (root keys never move x/y — the sim
      drives world position; only vertical z offsets, which are pose, not
      locomotion). Scene fps = 100 so every spec duration lands on an exact
      frame count. First key of the loop/windup actions is the identity
      (rest) pose; the slam-recover one-shot chains from the held pose
      (hound law).

      plod_idle    2.00s (201 frames, loop) — slow weight shift + lumber sway
      windup_slam  0.80s ( 81 frames)       — rear back + plates rise (telegraph)
      slam_recover 0.90s ( 91 frames)       — SLAM down + staggered settle to rest

    Export replaces public/assets/meshes/bulwark_slab.glb in place, same
    conventions as forge_anim_hound.py: glTF exporter's default +Y-up
    conversion, export_animation_mode="ACTIONS" over muted NLA stash
    tracks. Geometry-only (no materials) — the runtime shader material
    keeps applying.

Run:
    blender -b -P scripts/blender/forge_anim_bulwark.py -- out public/assets/meshes

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
BUDGETS = {"bulwark_slab": 600}

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


def slab_stack(bm, profile, sides=6, jitter=0.0, rng=None, phase=0.0):
    """VERTICAL elliptical ring stack for the slab torso: rings lie in the
    XY plane and bridge along **+Z** (the choir ring_stack pattern with
    separate rx/ry so the slab reads broader than deep). profile: list of
    (z, rx, ry, twist). Per-vertex jitter + progressive twist. Both ends
    capped."""
    rings = []
    for (z, rx, ry, tw) in profile:
        ring = []
        for k in range(sides):
            a = phase + tw + math.pi * 2.0 * k / sides
            jr = 1.0 + (rng.uniform(-jitter, jitter) if rng and jitter else 0.0)
            ring.append(bm.verts.new((math.cos(a) * rx * jr,
                                      math.sin(a) * ry * jr,
                                      z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((rings[i][k], rings[i][k2],
                          rings[i + 1][k2], rings[i + 1][k]))
    bm.faces.new(rings[-1])                   # top cap
    bm.faces.new(tuple(reversed(rings[0])))   # bottom cap
    return rings


def add_prism(bm, pos, r, z0, z1, rng):
    """4-sided vertical prism (a stub leg): quad ring at z0 and z1,
    bridged, both capped. ~16 tris. pos = (x, y) base center."""
    ring0, ring1 = [], []
    for i in range(4):
        a = math.pi / 4.0 + math.pi / 2.0 * i + rng.uniform(-0.12, 0.12)
        jr = r * rng.uniform(0.85, 1.15)
        ring0.append(bm.verts.new((pos[0] + math.cos(a) * jr,
                                   pos[1] + math.sin(a) * jr, z0)))
        ring1.append(bm.verts.new((pos[0] + math.cos(a) * jr,
                                   pos[1] + math.sin(a) * jr, z1)))
    for k in range(4):
        k2 = (k + 1) % 4
        bm.faces.new((ring0[k], ring0[k2], ring1[k2], ring1[k]))
    bm.faces.new(ring1)
    bm.faces.new(tuple(reversed(ring0)))


def add_slab(bm, pos, sx, sy, sz, rot_y=0.0, rot_z=0.0, rng=None, jitter=0.0):
    """Thin angular plate: box of half-extents sx/sy/sz, tilted rot_y about
    Y then yawed rot_z about Z, placed at pos. 6 faces. Jitter perturbs the
    corners so the plate keeps the chiseled hand-hewn read."""
    before = set(bm.verts)
    corners = []
    for dx in (-1.0, 1.0):
        for dy in (-1.0, 1.0):
            for dz in (-1.0, 1.0):
                j = 1.0 + (rng.uniform(-jitter, jitter) if rng and jitter else 0.0)
                corners.append(Vector((dx * sx * j, dy * sy * j, dz * sz)))
    v = [bm.verts.new(c) for c in corners]
    faces = [
        (0, 2, 6, 4),  # bottom
        (1, 5, 7, 3),  # top
        (0, 4, 5, 1),  # y- face
        (2, 3, 7, 6),  # y+ face
        (0, 1, 3, 2),  # x- face
        (4, 6, 7, 5),  # x+ face
    ]
    for f in faces:
        bm.faces.new(tuple(v[i] for i in f))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    verts = [v_ for v_ in bm.verts if v_ not in before]
    mat = (Matrix.Translation(pos)
           @ Matrix.Rotation(rot_z, 4, "Z")
           @ Matrix.Rotation(rot_y, 4, "Y"))
    bmesh.ops.transform(bm, matrix=mat, verts=verts)


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

def build_bulwark_slab(coll):
    """BULWARK SLAB — heavy sentinel: hex slab torso (broader than deep,
    wind-sheared taper), 2 stub legs, 2 angular shoulder plates leaning
    outward with spikes, brow visor bar on the -Y face. One bmesh,
    overlapping solids (plate inner faces buried in the torso)."""
    mesh = bpy.data.meshes.new("bulwark_slab")
    bm = bmesh.new()
    # torso: (z, rx, ry, twist) — shoulders widest, tapering to the crown
    profile = [
        (0.10, 0.50, 0.40, 0.00),
        (0.70, 0.55, 0.44, 0.05),
        (1.40, 0.64, 0.50, 0.12),   # shoulders — widest band
        (2.00, 0.52, 0.44, 0.20),
        (2.35, 0.34, 0.30, 0.28),
    ]
    slab_stack(bm, profile, sides=6, jitter=0.05, rng=RNG)
    # 2 stub legs — buried under the torso base
    add_prism(bm, (0.30, 0.05), 0.15, 0.00, 0.55, RNG)
    add_prism(bm, (-0.30, 0.05), 0.15, 0.00, 0.55, RNG)
    # shoulder plates: lean outward (+z top toward +/-X), inner face buried
    add_slab(bm, (0.66, 0.00, 1.55), 0.09, 0.34, 0.30, rot_y=0.20, rng=RNG, jitter=0.05)
    add_slab(bm, (-0.66, 0.00, 1.55), 0.09, 0.34, 0.30, rot_y=-0.20, rng=RNG, jitter=0.05)
    # plate spikes — points up-outward (yaw maps the +Y tilt to +/-X)
    add_shard(bm, (0.78, 0.00, 1.86), 0.06, 0.28, 0.25, -math.pi / 2, RNG)
    add_shard(bm, (-0.78, 0.00, 1.86), 0.06, 0.28, 0.25, math.pi / 2, RNG)
    # brow visor bar — proud of the -Y face (the slab's forward read)
    add_slab(bm, (0.00, -0.47, 1.72), 0.26, 0.05, 0.07, rng=RNG, jitter=0.04)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("bulwark_slab", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.020, 1)
    fit_dims(obj, 2.4, 2.2, anchor="center")
    return obj


# ----------------------------------------------------------- rig builders --

def mesh_bbox(obj):
    bpy.context.view_layer.update()
    lo = Vector((min(c[i] for c in obj.bound_box) for i in range(3)))
    hi = Vector((max(c[i] for c in obj.bound_box) for i in range(3)))
    return lo, hi


def build_bulwark_armature(coll, mesh_obj):
    """4 bones, roll 0, measured from the post-fit bbox: root (legs/pelvis)
    -> torso (mid..shoulders, both pointing +Z like the weaver root/bell),
    plateL/plateR riding the shoulder plates (pointing outward +/-X with a
    slight rise)."""
    lo, hi = mesh_bbox(mesh_obj)
    h = hi.z - lo.z
    rmax = max(abs(lo.x), abs(hi.x))
    z0, z1, z2 = lo.z, lo.z + 0.35 * h, lo.z + 0.80 * h
    zp = lo.z + 0.66 * h

    arm = bpy.data.armatures.new("bulwark_slab_rig")
    arm_obj = bpy.data.objects.new("bulwark_slab_rig", arm)
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

    b_root = bone("root", (0.0, 0.0, z0), (0.0, 0.0, z1))
    b_torso = bone("torso", (0.0, 0.0, z1), (0.0, 0.0, z2), b_root)
    b_plate_l = bone("plateL", (0.30 * rmax, 0.0, zp), (0.95 * rmax, 0.08, zp + 0.10 * h), b_torso)
    b_plate_r = bone("plateR", (-0.30 * rmax, 0.0, zp), (-0.95 * rmax, 0.08, zp + 0.10 * h), b_torso)
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
    (armature space). Computed, not assumed — root/torso point +Z while
    plateL/plateR point +/-X, so the conjugation matters."""
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
    law: x/y stay 0, vertical rise/slam only)."""
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


def build_bulwark_actions(arm_obj, qmap):
    """The three IN-PLACE actions. All root loc keys: x=0, y=0 (NO root
    motion law); loop/windup first key = identity rest pose; slam_recover
    chains from the held windup pose (hound law)."""
    acts = {}

    # --- plod_idle 2.0s loop: slow weight shift + lumber sway --------------
    a = make_action("plod_idle")
    f = (1, 51, 101, 151, 200)
    key_loc_world(a, arm_obj, "root", f,
                  [(0, 0, 0), (0, 0, -0.03), (0, 0, 0), (0, 0, -0.03), (0, 0, 0)], qmap)
    # torso: yaw shift (Z) + faint lean (X) merged on one shared frame list
    key_rot_world(a, "torso", f,
                  [rot((0, 0, 1), 0.05) @ rot((1, 0, 0), -0.03),
                   rot((0, 0, 1), 0.00) @ rot((1, 0, 0), 0.03),
                   rot((0, 0, 1), -0.05) @ rot((1, 0, 0), -0.03),
                   rot((0, 0, 1), 0.00) @ rot((1, 0, 0), 0.03),
                   rot((0, 0, 1), 0.05) @ rot((1, 0, 0), -0.03)], qmap)
    # plates counter-tilt about world Y (weight shift read)
    key_rot_world(a, "plateL", f,
                  [rot((0, 1, 0), -0.06), rot((0, 1, 0), 0.05),
                   rot((0, 1, 0), -0.06), rot((0, 1, 0), 0.05),
                   rot((0, 1, 0), -0.06)], qmap)
    key_rot_world(a, "plateR", f,
                  [rot((0, 1, 0), 0.06), rot((0, 1, 0), -0.05),
                   rot((0, 1, 0), 0.06), rot((0, 1, 0), -0.05),
                   rot((0, 1, 0), 0.06)], qmap)
    acts["plod_idle"] = a

    # --- windup_slam 0.8s: rear back + plates rise (telegraph) -------------
    a = make_action("windup_slam")
    f = (1, 40, 81)
    key_loc_world(a, arm_obj, "root", f, [(0, 0, 0), (0, 0, 0.07), (0, 0, 0.07)], qmap)
    key_rot_world(a, "torso", f,
                  [ID, rot((1, 0, 0), -0.30), rot((1, 0, 0), -0.30)], qmap)
    # plates rise: tilt up-outward (rot -Y lifts the +X tip, +Y lifts -X)
    key_rot_world(a, "plateL", f,
                  [ID, rot((0, 1, 0), -0.38), rot((0, 1, 0), -0.38)], qmap)
    key_rot_world(a, "plateR", f,
                  [ID, rot((0, 1, 0), 0.38), rot((0, 1, 0), 0.38)], qmap)
    acts["windup_slam"] = a

    # --- slam_recover 0.9s: SLAM down + staggered settle to rest -----------
    a = make_action("slam_recover")
    key_loc_world(a, arm_obj, "root", (1, 22, 48, 91),
                  [(0, 0, 0.07), (0, 0, -0.22), (0, 0, -0.10), (0, 0, 0)], qmap)
    key_rot_world(a, "torso", (1, 22, 48, 91),
                  [rot((1, 0, 0), -0.30), rot((1, 0, 0), 0.26), rot((1, 0, 0), 0.10), ID], qmap)
    key_rot_world(a, "plateL", (1, 22, 48, 91),
                  [rot((0, 1, 0), -0.38), rot((0, 1, 0), 0.42), rot((0, 1, 0), 0.12), ID], qmap)
    key_rot_world(a, "plateR", (1, 22, 48, 91),
                  [rot((0, 1, 0), 0.38), rot((0, 1, 0), -0.42), rot((0, 1, 0), -0.12), ID], qmap)
    acts["slam_recover"] = a

    return acts


def stash_actions(arm_obj, acts):
    """Push every action to a MUTED NLA track named after the action — the
    exporter's ACTIONS mode picks stashed actions up as separate glTF
    animations and the rig stays NLA-ready in the .blend sense."""
    ad = arm_obj.animation_data_create()
    ad.action = None
    for name in ("plod_idle", "windup_slam", "slam_recover"):
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

    # windup_slam end: root should RISE +0.07 in world z
    ad.action = acts["windup_slam"]
    sc.frame_set(81)
    bpy.context.view_layer.update()
    d = arm_obj.pose.bones["root"].matrix.to_translation() - rest_pos("root")
    print(f"POSE_CHECK windup@81 root_delta=({d.x:+.3f},{d.y:+.3f},{d.z:+.3f}) expect z=+0.070")

    # plod_idle mid: torso should YAW -0.05 about world Z
    ad.action = acts["plod_idle"]
    sc.frame_set(101)
    bpy.context.view_layer.update()
    pb = arm_obj.pose.bones["torso"]
    rest_axis = pb.bone.matrix_local.to_3x3() @ Vector((0.0, 1.0, 0.0))
    cur_axis = pb.matrix.to_3x3() @ Vector((0.0, 1.0, 0.0))
    ang = rest_axis.angle(cur_axis)
    print(f"POSE_CHECK idle@101 torso_yaw={math.degrees(ang):.2f}deg expect~2.86 (0.05rad)")
    ad.action = None
    sc.frame_set(1)


# --------------------------------------------------------------- the build --

bpy.ops.wm.read_factory_settings(use_empty=True)

scene = bpy.context.scene
scene.render.fps = FPS
scene.render.fps_base = 1.0

BUILDERS = [("bulwark_slab", build_bulwark_slab)]

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
bulwark = bpy.data.objects["bulwark_slab"]
arm = build_bulwark_armature(built["bulwark_slab"], bulwark)

lo, hi = mesh_bbox(bulwark)
h = hi.z - lo.z
rmax = max(abs(lo.x), abs(hi.x))
z0, z1, z2 = lo.z, lo.z + 0.35 * h, lo.z + 0.80 * h
zp = lo.z + 0.66 * h
SEGMENTS = {
    "root": ((0, 0, z0), (0, 0, z1)),
    "torso": ((0, 0, z1), (0, 0, z2)),
    "plateL": ((0.30 * rmax, 0, zp), (0.95 * rmax, 0.08, zp + 0.10 * h)),
    "plateR": ((-0.30 * rmax, 0, zp), (-0.95 * rmax, 0.08, zp + 0.10 * h)),
}
proximity_skin(bulwark, arm, SEGMENTS)

qmap = rest_rel_rotations(arm)
acts = build_bulwark_actions(arm, qmap)
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
      f"actions=3 rig=root,torso,plateL,plateR")
