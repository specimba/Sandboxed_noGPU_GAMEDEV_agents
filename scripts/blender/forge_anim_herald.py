"""HOLLOW SUN — forge_anim_herald: Sprint 20-4b "LIVING FOES II". Rigs the
HERALD BELL through the EXACT forge_anim_hound.py (Task 19-b) recipe —
same seed default, same RNG consumption order, same helper structure, same
in-place action law (the vertical hovering sibling of forge_anim_weaver):

    - SILHOUETTE: flared bell/chalice that hovers. Vertical +Z build (foe
      body anchor="center", weaver convention): 6-ring shell crowning to a
      knob and flaring to a wide rim, 3 hanging rim teeth, an internal
      clapper prism with an exposed tip, a crown fin. Angular + chiseled.

    - ARMATURE: 3 bones (root, skirt, clapper), roll 0, measured from the
      post-fit mesh bbox. root runs the upper axis (+Z, weaver root law —
      it owns the hover bob), skirt sweeps a DIAGONAL segment through the
      lower shell wall (weaver rim_tip precedent — the rim reads its sway),
      clapper hangs below the rim (the exposed tongue).

    - AUTOMATIC PROXIMITY SKINNING: per-vertex weights = 1/d^3 against each
      bone's rest segment (top-2 kept, normalized) -> vertex groups +
      armature modifier. No mesh geometry is touched by the rig.

    - NLA-READY ACTIONS, all IN-PLACE (root keys never move x/y — the sim
      drives world position; only vertical z offsets, which are pose, not
      locomotion). Scene fps = 100 so every spec duration lands on an exact
      frame count. First key of every action is the identity (rest) pose so
      runtime crossfades blend from any state.

      hover_idle  2.00s (201 frames, loop) — hover bob + shell sway + clapper slack
      bell_swing  1.00s (101 frames)       — clapper wind + swing + bell rock
      chime_pulse 0.60s ( 61 frames)       — radial shimmy pulse (the veil volley read)
      recover     0.80s ( 81 frames)       — settle wobble back to rest

    Export replaces public/assets/meshes/herald_bell.glb in place, same
    conventions as forge_anim_weaver.py: glTF exporter's default +Y-up
    conversion, export_animation_mode="ACTIONS" over muted NLA stash
    tracks. Geometry-only (no materials) — the runtime shader material
    keeps applying.

Run:
    blender -b -P scripts/blender/forge_anim_herald.py -- out public/assets/meshes

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
BUDGETS = {"herald_bell": 600}

FPS = 100  # exact frames for every spec duration


# ----------------------------------------------------------------- helpers --
# (same conventions as forge_anim_weaver.py / forge_choir.py)

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
    (foe-body convention, matches husk_drifter/hex_weaver)."""
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


def ring_stack(bm, profile, sides=6, jitter=0.0, rng=None, phase=0.0):
    """Append a closed faceted prism defined by a ring profile (choir law:
    vertical +Z bridge). profile: list of (z, radius, cx, cy, twist) — one
    n-gon ring per entry, bridged bottom-to-top, both ends capped."""
    rings = []
    for (z, r, cx, cy, tw) in profile:
        ring = []
        for k in range(sides):
            a = phase + tw + math.pi * 2.0 * k / sides
            jr = r * (1.0 + (rng.uniform(-jitter, jitter) if rng and jitter else 0.0))
            ring.append(bm.verts.new((cx + math.cos(a) * jr,
                                      cy + math.sin(a) * jr, z)))
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
    """4-sided vertical prism (the clapper shaft): quad ring at z0 and z1,
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


def add_shard(bm, pos, r, h, tilt, yaw, rng):
    """4-sided predatory spike (quad base ring + apex), same as
    forge_library.py: built along local +Z, tilted toward +Y by `tilt`,
    yawed around Z, placed at `pos`. ~6 tris. tilt near pi flips it DOWN."""
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

def build_herald_bell(coll):
    """HERALD BELL — flared hovering bell: 6-ring shell crowning to a knob
    and flaring to a wide rim, 3 hanging rim teeth, internal clapper prism
    with an exposed tip, crown fin. One bmesh, overlapping solids (clapper
    shaft buried through the shell core, teeth bases buried in the rim)."""
    mesh = bpy.data.meshes.new("herald_bell")
    bm = bmesh.new()
    # shell: (z, r, cx, cy, twist) — narrow crown, wide flared rim
    profile = [
        (2.30, 0.13, 0.00, 0.00, 0.00),   # crown tip
        (2.05, 0.30, 0.00, 0.00, 0.10),   # crown
        (1.60, 0.50, 0.00, 0.00, 0.22),   # shoulder
        (1.10, 0.45, 0.00, 0.00, 0.34),   # waist
        (0.50, 0.58, 0.00, 0.00, 0.46),   # flare
        (0.05, 0.76, 0.00, 0.00, 0.58),   # rim
    ]
    ring_stack(bm, profile, sides=6, jitter=0.05, rng=RNG)
    # 3 rim teeth — hanging spikes around the skirt
    for k in range(3):
        a = math.pi * 2.0 * k / 3.0 + 0.5
        add_shard(bm, (math.cos(a) * 0.58, math.sin(a) * 0.58, 0.10),
                  0.05, 0.28, math.pi - 0.28, a, RNG)
    # clapper: internal shaft + exposed tip below the rim
    add_prism(bm, (0.0, 0.0), 0.085, -0.50, 0.75, RNG)
    add_shard(bm, (0.0, 0.0, -0.46), 0.06, 0.20, math.pi - 0.12, 0.0, RNG)
    # crown fin
    add_shard(bm, (0.0, 0.0, 2.28), 0.055, 0.26, -0.12, 0.0, RNG)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("herald_bell", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.018, 1)
    fit_dims(obj, 2.6, 1.7, anchor="center")
    return obj


# ----------------------------------------------------------- rig builders --

def mesh_bbox(obj):
    bpy.context.view_layer.update()
    lo = Vector((min(c[i] for c in obj.bound_box) for i in range(3)))
    hi = Vector((max(c[i] for c in obj.bound_box) for i in range(3)))
    return lo, hi


def build_herald_armature(coll, mesh_obj):
    """3 bones, roll 0, measured from the post-fit bbox: root up the upper
    axis (+Z, weaver root law — owns the hover bob), skirt sweeping a
    DIAGONAL segment through the lower shell wall (weaver rim_tip precedent
    — the rim reads its sway), clapper hanging below the rim."""
    lo, hi = mesh_bbox(mesh_obj)
    h = hi.z - lo.z
    rmax = max(abs(lo.x), abs(hi.x), abs(lo.y), abs(hi.y))
    z0, z1 = lo.z, lo.z + 0.54 * h

    arm = bpy.data.armatures.new("herald_bell_rig")
    arm_obj = bpy.data.objects.new("herald_bell_rig", arm)
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

    b_root = bone("root", (0.0, 0.0, z1), (0.0, 0.0, hi.z))
    b_skirt = bone("skirt", (0.0, 0.0, z1), (0.80 * rmax, 0.0, z0 + 0.05 * h), b_root)
    b_clap = bone("clapper", (0.0, 0.0, lo.z + 0.08 * h), (0.0, 0.0, lo.z - 0.03 * h), b_root)
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
    (armature space). Computed, not assumed — root points +Z, skirt sweeps
    a diagonal, clapper points DOWN, so the conjugation matters."""
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
    law: x/y stay 0, vertical hover/bounce only)."""
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


def build_herald_actions(arm_obj, qmap):
    """The four IN-PLACE actions. All root loc keys: x=0, y=0 (NO root
    motion law); first key of every action = identity rest pose."""
    acts = {}

    # --- hover_idle 2.0s loop: hover bob + shell sway + clapper slack ------
    a = make_action("hover_idle")
    f = (1, 51, 101, 151, 200)
    key_loc_world(a, arm_obj, "root", f,
                  [(0, 0, 0), (0, 0, -0.06), (0, 0, 0), (0, 0, -0.06), (0, 0, 0)], qmap)
    # skirt: tilt sway (X, 2 cycles) + slow twist (Z, 1 cycle), merged
    key_rot_world(a, "skirt", f,
                  [rot((1, 0, 0), 0.06) @ rot((0, 0, 1), 0.00),
                   rot((1, 0, 0), -0.06) @ rot((0, 0, 1), 0.04),
                   rot((1, 0, 0), 0.06) @ rot((0, 0, 1), 0.00),
                   rot((1, 0, 0), -0.06) @ rot((0, 0, 1), -0.04),
                   rot((1, 0, 0), 0.06) @ rot((0, 0, 1), 0.00)], qmap)
    key_rot_world(a, "clapper", (1, 101, 200),
                  [rot((1, 0, 0), 0.00), rot((1, 0, 0), 0.05), rot((1, 0, 0), 0.00)], qmap)
    acts["hover_idle"] = a

    # --- bell_swing 1.0s: clapper wind + swing + bell rock ------------------
    a = make_action("bell_swing")
    key_rot_world(a, "clapper", (1, 35, 62, 80, 101),
                  [ID, rot((1, 0, 0), -0.45), rot((1, 0, 0), 0.60),
                   rot((1, 0, 0), 0.15), ID], qmap)
    # the shell rocks against the strike (bells ring physically)
    key_rot_world(a, "skirt", (1, 40, 62, 80, 101),
                  [ID, rot((1, 0, 0), 0.06), rot((1, 0, 0), -0.10),
                   rot((1, 0, 0), -0.04), ID], qmap)
    key_loc_world(a, arm_obj, "root", (1, 40, 62, 80, 101),
                  [(0, 0, 0), (0, 0, -0.03), (0, 0, -0.05), (0, 0, -0.02), (0, 0, 0)], qmap)
    acts["bell_swing"] = a

    # --- chime_pulse 0.6s: radial shimmy pulse (the veil volley read) ------
    a = make_action("chime_pulse")
    f = (1, 16, 31, 46, 61)
    key_loc_world(a, arm_obj, "root", f,
                  [(0, 0, 0), (0, 0, -0.10), (0, 0, -0.02), (0, 0, -0.08), (0, 0, 0)], qmap)
    key_rot_world(a, "skirt", f,
                  [ID, rot((0, 0, 1), 0.16), rot((0, 0, 1), -0.16),
                   rot((0, 0, 1), 0.10), ID], qmap)
    key_rot_world(a, "clapper", f,
                  [ID, rot((0, 0, 1), 0.30), rot((0, 0, 1), -0.25),
                   rot((0, 0, 1), 0.15), ID], qmap)
    acts["chime_pulse"] = a

    # --- recover 0.8s: settle wobble back to rest ---------------------------
    a = make_action("recover")
    key_loc_world(a, arm_obj, "root", (1, 26, 52, 81),
                  [(0, 0, -0.10), (0, 0, -0.14), (0, 0, -0.04), (0, 0, 0)], qmap)
    key_rot_world(a, "skirt", (1, 30, 55, 81),
                  [rot((1, 0, 0), 0.10), rot((1, 0, 0), -0.06),
                   rot((1, 0, 0), 0.02), ID], qmap)
    key_rot_world(a, "clapper", (1, 36, 60, 81),
                  [rot((1, 0, 0), 0.30), rot((1, 0, 0), 0.10),
                   rot((1, 0, 0), -0.04), ID], qmap)
    acts["recover"] = a

    return acts


def stash_actions(arm_obj, acts):
    """Push every action to a MUTED NLA track named after the action — the
    exporter's ACTIONS mode picks stashed actions up as separate glTF
    animations and the rig stays NLA-ready in the .blend sense."""
    ad = arm_obj.animation_data_create()
    ad.action = None
    for name in ("hover_idle", "bell_swing", "chime_pulse", "recover"):
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

    # bell_swing strike frame: clapper should SWING 0.60 rad about world X
    ad.action = acts["bell_swing"]
    sc.frame_set(62)
    bpy.context.view_layer.update()
    pb = arm_obj.pose.bones["clapper"]
    rest_axis = pb.bone.matrix_local.to_3x3() @ Vector((0.0, 1.0, 0.0))
    cur_axis = pb.matrix.to_3x3() @ Vector((0.0, 1.0, 0.0))
    ang = rest_axis.angle(cur_axis)
    print(f"POSE_CHECK swing@62 clapper_swing={math.degrees(ang):.2f}deg "
          f"expect~34.38 (0.60rad)")

    # hover_idle bob frame: root should DROP -0.06 in world z
    ad.action = acts["hover_idle"]
    sc.frame_set(51)
    bpy.context.view_layer.update()
    d = arm_obj.pose.bones["root"].matrix.to_translation() - rest_pos("root")
    print(f"POSE_CHECK hover@51 root_delta=({d.x:+.3f},{d.y:+.3f},{d.z:+.3f}) expect z=-0.060")
    ad.action = None
    sc.frame_set(1)


# --------------------------------------------------------------- the build --

bpy.ops.wm.read_factory_settings(use_empty=True)

scene = bpy.context.scene
scene.render.fps = FPS
scene.render.fps_base = 1.0

BUILDERS = [("herald_bell", build_herald_bell)]

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
herald = bpy.data.objects["herald_bell"]
arm = build_herald_armature(built["herald_bell"], herald)

lo, hi = mesh_bbox(herald)
h = hi.z - lo.z
rmax = max(abs(lo.x), abs(hi.x), abs(lo.y), abs(hi.y))
z0, z1 = lo.z, lo.z + 0.54 * h
SEGMENTS = {
    "root": ((0, 0, z1), (0, 0, hi.z)),
    "skirt": ((0, 0, z1), (0.80 * rmax, 0, z0 + 0.05 * h)),
    "clapper": ((0, 0, lo.z + 0.08 * h), (0, 0, lo.z - 0.03 * h)),
}
proximity_skin(herald, arm, SEGMENTS)

qmap = rest_rel_rotations(arm)
acts = build_herald_actions(arm, qmap)
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
      f"actions=4 rig=root,skirt,clapper")
