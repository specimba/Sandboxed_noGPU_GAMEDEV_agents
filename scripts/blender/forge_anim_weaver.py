"""HOLLOW SUN — forge_anim_weaver: Sprint 19-b "LIVING FOES". Rebuilds the
HEX WEAVER through the EXACT forge_weaver.py (Task 16) recipe — mesh-building
helpers + build_hex_weaver copied verbatim, same seed default, same RNG
consumption order — so the flat hex lattice silhouette is byte-for-byte the
static asset, then makes it ALIVE:

    - ARMATURE: 3 bones (root, bell, rim_tip). root runs up the hub axis
      (needle -> hub), bell continues through the lattice disc, rim_tip sits
      on the +X outer hex arc (the lattice spins at runtime, so one rim bone
      reads as an asymmetric flutter — the loom "breathes").
    - AUTOMATIC PROXIMITY SKINNING: per-vertex weights = 1/d^3 against each
      bone's rest segment (top-2 kept, normalized) -> vertex groups + armature
      modifier. No mesh geometry is touched: tri count stays at the Task-16
      recipe count.
    - NLA-READY ACTIONS, all IN-PLACE (root keys never move x/y — the sim
      drives world position; only vertical z offsets, which are pose, not
      locomotion). Scene fps = 100 so every spec duration lands on an exact
      frame count. First key of every action is the identity (rest) pose.

      hover_idle     2.0s (201 frames, loop) — hover bob + lattice tilt breathe + rim flutter
      anchor_cast    0.9s ( 91 frames)       — rear-back, hold, SLAM down (HEX.telegraph 0.9)
      death_collapse 0.6s ( 61 frames)       — drop + topple + flatten (non-loop)

    Export replaces public/assets/meshes/hex_weaver.glb in place, same
    conventions as forge_weaver.py: +Z build (centered, husk_drifter
    convention), glTF exporter's default +Y-up conversion. Geometry-only
    (no materials) — the runtime shader material keeps applying.

Run:
    blender -b -P scripts/blender/forge_anim_weaver.py -- out public/assets/meshes

Arguments (after `--`):
    out DIR        output directory for .glb files (default: public/assets/meshes)
    --seed N       override the fixed seed (default 42 — the Task-16 recipe seed)
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

# tri budget = Task-16 recipe count (572) +10%
BUDGETS = {"hex_weaver": 629}

FPS = 100  # exact frames for every spec duration


# ----------------------------------------------------------------- helpers --
# ==================== VERBATIM RECIPE (scripts/blender/forge_weaver.py) =====

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


def hex_ring(bm, z, r, phase=0.0, jitter=0.0, rng=None):
    """One flat hexagon of verts in the XZ plane at height z."""
    ring = []
    for k in range(6):
        a = phase + math.pi * 2.0 * k / 6.0
        jr = r * (1.0 + (rng.uniform(-jitter, jitter) if rng and jitter else 0.0))
        ring.append(bm.verts.new((math.cos(a) * jr, math.sin(a) * jr, z)))
    return ring


def bridge(bm, r0, r1, close0=True, close1=True):
    """Bridge two same-length vert rings with quads; optionally cap ends."""
    n = len(r0)
    for k in range(n):
        k2 = (k + 1) % n
        bm.faces.new((r0[k], r0[k2], r1[k2], r1[k]))
    if close0:
        bm.faces.new(tuple(reversed(r0)))
    if close1:
        bm.faces.new(r1)


def add_spoke(bm, a, r0, r1, w, z, rng):
    """Radial flat spoke: an elongated thin box from r0 to r1 at angle a,
    thickness w (radial) × tz (vertical). ~12 tris."""
    ca, sa = math.cos(a), math.sin(a)
    jw = w * rng.uniform(0.85, 1.15)
    tz = 0.035
    p = [
        (ca * r0 - sa * jw, sa * r0 + ca * jw, z - tz),
        (ca * r0 + sa * jw, sa * r0 - ca * jw, z - tz),
        (ca * r1 + sa * jw, sa * r1 - ca * jw, z - tz),
        (ca * r1 - sa * jw, sa * r1 + ca * jw, z + tz),
        (ca * r0 - sa * jw, sa * r0 + ca * jw, z + tz),
        (ca * r0 + sa * jw, sa * r0 - ca * jw, z + tz),
        (ca * r1 + sa * jw, sa * r1 - ca * jw, z + tz),
        (ca * r1 - sa * jw, sa * r1 + ca * jw, z + tz),
    ]
    v = [bm.verts.new(p_) for p_ in p]
    faces = [
        (v[0], v[1], v[2], v[3]),  # bottom
        (v[7], v[6], v[5], v[4]),  # top
        (v[4], v[5], v[1], v[0]),  # inner cap
        (v[6], v[7], v[3], v[2]),  # outer cap
        (v[0], v[3], v[7], v[4]),  # side A
        (v[5], v[6], v[2], v[1]),  # side B
    ]
    for f in faces:
        bm.faces.new(f)


def add_prism(bm, pos, r, z0, z1, rng):
    """4-sided vertical prism (a strut): quad ring at z0 and z1, bridged,
    both capped. ~16 tris. pos = (x, y) base center."""
    ring0, ring1 = [], []
    for i in range(4):
        a = math.pi / 4.0 + math.pi / 2.0 * i + rng.uniform(-0.12, 0.12)
        jr = r * rng.uniform(0.85, 1.15)
        ring0.append(bm.verts.new((pos[0] + math.cos(a) * jr,
                                   pos[1] + math.sin(a) * jr, z0)))
        ring1.append(bm.verts.new((pos[0] + math.cos(a) * jr,
                                   pos[1] + math.sin(a) * jr, z1)))
    bridge(bm, ring0, ring1, close0=True, close1=True)


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


# ------------------------------------------------------------------ build --

def build_hex_weaver(coll):
    """The HEX LOOM: outer hex ring + 6 spokes + hub + 3 crowned struts +
    a hanging needle. Flat lattice — the zone-denial caster silhouette."""
    mesh = bpy.data.meshes.new("hex_weaver")
    bm = bmesh.new()

    phase = RNG.uniform(0.0, math.pi / 3.0)  # seeded ring rotation
    # outer hex ring — a hollow hex tube (bottom hex, top hex, bridged)
    r_bot = hex_ring(bm, -0.06, 1.00, phase=phase, jitter=0.03, rng=RNG)
    r_top = hex_ring(bm, 0.06, 1.00, phase=phase, jitter=0.03, rng=RNG)
    bridge(bm, r_bot, r_top, close0=True, close1=True)

    # 6 radiating spokes hub -> ring, alternating heights for a woven read
    for k in range(6):
        a = phase + math.pi * 2.0 * k / 6.0
        add_spoke(bm, a, 0.30, 0.97, 0.055, 0.02 + (0.045 if k % 2 else 0.0), RNG)

    # central hex hub — two stacked hex rings bridged
    h_bot = hex_ring(bm, -0.10, 0.34, phase=phase + math.pi / 6.0)
    h_top = hex_ring(bm, 0.20, 0.28, phase=phase + math.pi / 6.0)
    bridge(bm, h_bot, h_top, close0=True, close1=True)
    # two crowned struts on opposite corners (tri budget: 3 did not fit)
    for k in (0, 3):
        a = phase + math.pi * 2.0 * k / 6.0
        cx, cy = math.cos(a) * 0.92, math.sin(a) * 0.92
        add_prism(bm, (cx, cy), 0.07, -0.04, 0.42, RNG)
        add_shard(bm, (cx, cy, 0.40), 0.05, 0.30, 0.22 + RNG.uniform(-0.08, 0.08), a, RNG)

    # the needle — one spike hanging under the hub (the loom's sting)
    add_shard(bm, (0.0, 0.0, -0.08), 0.06, 0.52, math.pi - 0.30, 0.0, RNG)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("hex_weaver", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.018, 1)
    fit_dims(obj, 1.0, 2.0, anchor="center")
    return obj


# ===================== END VERBATIM RECIPE ==================================


# ----------------------------------------------------------- rig builders --

def mesh_bbox(obj):
    bpy.context.view_layer.update()
    lo = Vector((min(c[i] for c in obj.bound_box) for i in range(3)))
    hi = Vector((max(c[i] for c in obj.bound_box) for i in range(3)))
    return lo, hi


def build_weaver_armature(coll, mesh_obj):
    """3 bones: root up the hub axis (needle -> hub), bell continues through
    the lattice disc, rim_tip rides the +X outer hex arc. Segments derive
    from the MEASURED post-fit bbox."""
    lo, hi = mesh_bbox(mesh_obj)
    h = hi.z - lo.z
    rmax = max(abs(lo.x), abs(hi.x), abs(lo.y), abs(hi.y))
    z0, z1, z2 = lo.z, lo.z + 0.45 * h, lo.z + 0.85 * h
    zm = (lo.z + hi.z) / 2.0

    arm = bpy.data.armatures.new("hex_weaver_rig")
    arm_obj = bpy.data.objects.new("hex_weaver_rig", arm)
    coll.objects.link(arm_obj)
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    e_root = arm.edit_bones.new("root")
    e_root.head, e_root.tail = Vector((0.0, 0.0, z0)), Vector((0.0, 0.0, z1))
    e_root.roll = 0.0
    e_root.use_connect = False

    e_bell = arm.edit_bones.new("bell")
    e_bell.head, e_bell.tail = Vector((0.0, 0.0, z1)), Vector((0.0, 0.0, z2))
    e_bell.roll = 0.0
    e_bell.use_connect = False
    e_bell.parent = e_root

    e_rim = arm.edit_bones.new("rim_tip")
    e_rim.head, e_rim.tail = Vector((0.42 * rmax, 0.0, zm)), Vector((0.98 * rmax, 0.0, zm))
    e_rim.roll = 0.0
    e_rim.use_connect = False
    e_rim.parent = e_bell

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

def rest_rel_rotations(arm_obj):
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
    law: x/y stay 0, vertical hover/slam only)."""
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


def build_weaver_actions(arm_obj, qmap):
    """The three IN-PLACE actions. All root loc keys: x=0, y=0 (NO root
    motion law); first key of every action = identity rest pose."""
    acts = {}

    # --- hover_idle 2.0s loop: hover bob + lattice breathe + rim flutter ---
    a = make_action("hover_idle")
    f = (1, 51, 101, 151, 200)
    key_loc_world(a, arm_obj, "root", f,
                  [(0, 0, 0), (0, 0, -0.05), (0, 0, 0), (0, 0, -0.05), (0, 0, 0)], qmap)
    # bell: tilt breathe X (2 cycles) + slight twist Z (1 cycle), merged
    key_rot_world(a, "bell", f,
                  [rot((1, 0, 0), 0.05) @ rot((0, 0, 1), 0.00),
                   rot((1, 0, 0), -0.05) @ rot((0, 0, 1), 0.03),
                   rot((1, 0, 0), 0.05) @ rot((0, 0, 1), 0.00),
                   rot((1, 0, 0), -0.05) @ rot((0, 0, 1), -0.03),
                   rot((1, 0, 0), 0.05) @ rot((0, 0, 1), 0.00)], qmap)
    key_rot_world(a, "rim_tip", f,
                  [ID, rot((1, 0, 0), 0.22), ID, rot((1, 0, 0), -0.22), ID], qmap)
    acts["hover_idle"] = a

    # --- anchor_cast 0.9s: rear-back, hold, SLAM down (HEX.telegraph 0.9) --
    a = make_action("anchor_cast")
    key_loc_world(a, arm_obj, "root", (1, 34, 52, 62, 78, 90),
                  [(0, 0, 0), (0, 0, 0.10), (0, 0, 0.10), (0, 0, -0.34),
                   (0, 0, -0.18), (0, 0, -0.10)], qmap)
    key_rot_world(a, "bell", (1, 30, 48, 60, 75, 90),
                  [ID, rot((1, 0, 0), -0.38), rot((1, 0, 0), -0.38),
                   rot((1, 0, 0), 0.32), rot((1, 0, 0), 0.18), rot((1, 0, 0), 0.10)], qmap)
    key_rot_world(a, "rim_tip", (1, 52, 62, 78, 90),
                  [ID, rot((0, 0, 1), -0.30), rot((0, 0, 1), 0.55),
                   rot((0, 0, 1), -0.10), ID], qmap)
    acts["anchor_cast"] = a

    # --- death_collapse 0.6s non-loop: drop + topple + flatten -------------
    a = make_action("death_collapse")
    key_loc_world(a, arm_obj, "root", (1, 16, 40, 60),
                  [(0, 0, 0), (0, 0, -0.10), (0, 0, -0.52), (0, 0, -0.56)], qmap)
    key_rot_world(a, "bell", (1, 20, 60),
                  [ID, rot((1, 0, 0), -0.15),
                   rot((1, 0, 0), 0.42) @ rot((0, 0, 1), 0.35)], qmap)
    key_rot_world(a, "rim_tip", (1, 60), [ID, rot((1, 0, 0), -0.60)], qmap)
    acts["death_collapse"] = a

    return acts


def stash_actions(arm_obj, acts):
    """Push every action to a MUTED NLA track named after the action — the
    exporter's ACTIONS mode picks stashed actions up as separate glTF
    animations and the rig stays NLA-ready in the .blend sense."""
    ad = arm_obj.animation_data_create()
    ad.action = None
    for name in ("hover_idle", "anchor_cast", "death_collapse"):
        act = acts[name]
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name=name, start=int(act.frame_range[0]), action=act)
        strip.name = name
        track.mute = True
    print("FORGE_NLA tracks=" + ",".join(acts))


def pose_check(arm_obj, acts, qmap):
    """Self-check: evaluate key poses and print ARMATURE-space deltas so the
    receipt proves the conjugated keys move bones the intended way."""
    ad = arm_obj.animation_data_create()
    sc = bpy.context.scene

    def rest_pos(name):
        return arm_obj.pose.bones[name].bone.matrix_local.to_translation()

    # anchor_cast slam frame: root should DROP -0.34 in world z
    ad.action = acts["anchor_cast"]
    sc.frame_set(62)
    bpy.context.view_layer.update()
    d = arm_obj.pose.bones["root"].matrix.to_translation() - rest_pos("root")
    print(f"POSE_CHECK cast@62 root_delta=({d.x:+.3f},{d.y:+.3f},{d.z:+.3f}) expect z=-0.340")

    # hover_idle mid: bell should TILT 0.05 rad about world X
    ad.action = acts["hover_idle"]
    sc.frame_set(51)
    bpy.context.view_layer.update()
    pb = arm_obj.pose.bones["bell"]
    rest_axis = pb.bone.matrix_local.to_3x3() @ Vector((0.0, 1.0, 0.0))
    cur_axis = pb.matrix.to_3x3() @ Vector((0.0, 1.0, 0.0))
    ang = rest_axis.angle(cur_axis)
    print(f"POSE_CHECK hover@51 bell_tilt={math.degrees(ang):.2f}deg expect~2.86 (0.05rad)")
    ad.action = None
    sc.frame_set(1)


# --------------------------------------------------------------- the build --

bpy.ops.wm.read_factory_settings(use_empty=True)

scene = bpy.context.scene
scene.render.fps = FPS
scene.render.fps_base = 1.0

BUILDERS = [("hex_weaver", build_hex_weaver)]

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
weaver = bpy.data.objects["hex_weaver"]
arm = build_weaver_armature(built["hex_weaver"], weaver)

lo, hi = mesh_bbox(weaver)
h = hi.z - lo.z
rmax = max(abs(lo.x), abs(hi.x), abs(lo.y), abs(hi.y))
z0, z1, z2 = lo.z, lo.z + 0.45 * h, lo.z + 0.85 * h
zm = (lo.z + hi.z) / 2.0
SEGMENTS = {
    "root": ((0, 0, z0), (0, 0, z1)),
    "bell": ((0, 0, z1), (0, 0, z2)),
    "rim_tip": ((0.42 * rmax, 0, zm), (0.98 * rmax, 0, zm)),
}
proximity_skin(weaver, arm, SEGMENTS)

qmap = rest_rel_rotations(arm)
acts = build_weaver_actions(arm, qmap)
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
      f"actions=3 rig=root,bell,rim_tip")
