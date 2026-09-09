"""HOLLOW SUN — forge_choir: Task 18-1. Sprint 18 "PALE CHOIR" biome-4 prop
family, forged through the same pipeline conventions as forge_library.py
(Task 13-a) and forge_hound.py (Task 15):

    - one bpy pass, one named collection per asset, batch glTF export
      (unlink/link root collections)
    - fixed seed -> deterministic, byte-similar output
    - beveled + flat-shaded (the EMBER RITE chiseled look)
    - geometry only (runtime owns materials)

    PROPS ARE NOT HOUNDS: vertical convention — built along Blender **+Z**,
    base at z=0 (forge_library.py prop law), anchor="base". The hound's
    snout-forward law does NOT apply to props (no forward-facing claim).

    rib_arch           — pointed gothic arch: 2 interlocking rib bands
                         (arc-swept ring stacks along a pointed-arch path,
                         tapered radius, progressive twist) + 3 keystone
                         shards. h 5.0, footprint 3.2, <= 600 tris.
    bone_spire         — 4 snapped bone-glass needles on a fractured plinth
                         (glass_spire sibling recipe). h 4.6, footprint 2.4.
    pipe_organ_cluster — 7 graded square tapered pipes (4-sided ring stacks,
                         graded heights, mitered lip cap on the hero pipe)
                         on a chest plinth. h 3.8, footprint 2.6.
    reliquary_lantern  — obsidian box + 4 corner finial shards + inner
                         bone-glass core prism. h 2.2, footprint 1.4.
    choir_pulpit       — tapered hex drum (ring_stack 6 sides x 3 rings)
                         + 2 shard sounding wings. h 2.8, footprint 1.8.

    GEOMETRY-NODES LESSON (sprint 18 brief): every modifier is APPLIED via
    apply_mods() BEFORE tri_count(), and the export runs with
    export_apply=True — bake, then quantify, then verify. House style builds
    via bmesh directly (deterministic, no generator state divergence).

Run:
    blender -b -P scripts/blender/forge_choir.py -- out public/assets/meshes
    blender -b -P scripts/blender/forge_choir.py -- out public/assets/meshes --only rib_arch

Arguments (after `--`):
    out DIR        output directory for .glb files (default: public/assets/meshes)
    --only a,b     export only these assets (comma separated)
    --seed N       override the fixed seed (default 42)
"""
import bpy
import bmesh
import math
import os
import random
import sys

from mathutils import Matrix, Vector

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
ONLY = arg_value("--only")
ONLY = set(x.strip() for x in ONLY.split(",") if x.strip()) if ONLY else None
SEED = int(arg_value("--seed", default="42"))
RNG = random.Random(SEED)

os.makedirs(OUT_DIR, exist_ok=True)

# triangle budgets (hard spec from the 18-GATE contract: all <= 600)
BUDGETS = {
    "rib_arch": 600,
    "bone_spire": 600,
    "pipe_organ_cluster": 600,
    "reliquary_lantern": 600,
    "choir_pulpit": 600,
}

# ----------------------------------------------------------------- helpers --
# (same conventions as forge_library.py / forge_hound.py)


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


def rng_uniform(a, b):
    return RNG.uniform(a, b)


def tri_count(obj):
    """Final exported triangle count (glTF triangulates exactly like this)."""
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def fit_dims(obj, target_h, target_w=None, anchor="base"):
    """Normalize the mesh to the exact spec: uniform-scale to target height,
    optional x/y scale to target footprint, then re-anchor.

    anchor="base"  -> min z = 0, x/y centered   (props standing on the floor)
    anchor="center"-> bbox center at the origin (foe-body convention)
    """
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
    # z gets the uniform height scale; x/y get the ABSOLUTE footprint scale
    # (s_w already relates to the pre-scale measurement — composing it with
    # s_h again would under/over-shoot the footprint whenever s_h != 1)
    obj.scale = (s_w, s_w, s_h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    lo, hi, size = bbox()
    if anchor == "base":
        off = Vector((-(lo.x + hi.x) / 2.0, -(lo.y + hi.y) / 2.0, -lo.z))
    else:
        off = Vector((-(lo.x + hi.x) / 2.0, -(lo.y + hi.y) / 2.0,
                      -(lo.z + hi.z) / 2.0))
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
    """Append a closed faceted prism defined by a ring profile.

    profile: list of (z, radius, cx, cy, twist) — one n-gon ring per entry,
    bridged bottom-to-top, both ends capped. Per-vertex radius jitter +
    progressive twist = the gnarled/chiseled read. Returns the list of rings.
    """
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


def arc_band(bm, path, sides=3, r0=0.17, r1=0.10, jitter=0.0, rng=None,
             twist0=0.0, twist1=0.9, phase=0.0):
    """Append a faceted rib band swept along a 3D polyline `path` — the arc
    variant of ring_stack: one n-gon ring per path station, lying in the
    plane PERPENDICULAR to the local path tangent, radius lerped r0->r1 and
    twist accumulated twist0->twist1 around the tangent (progressive twist
    = the gnarled rib read). Both ends capped. Returns the list of rings.
    """
    rings = []
    ref = Vector((0.0, 1.0, 0.0))   # arch paths live in XZ — Y is always ⟂
    n = len(path)
    for i, p in enumerate(path):
        t = i / max(n - 1, 1)
        prev = path[max(i - 1, 0)]
        nxt = path[min(i + 1, n - 1)]
        tan = nxt - prev
        if tan.length < 1e-6:
            tan = Vector((0.0, 0.0, 1.0))
        tan.normalize()
        u = ref.cross(tan)           # ⟂ tangent (frame axis 1)
        if u.length < 1e-6:
            u = Vector((1.0, 0.0, 0.0))
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


def arch_path(span, pier_h, arc_r, arc_steps):
    """Pointed gothic arch polyline in the XZ plane (y=0), feet at z=0.

    Two equilateral-style arcs (radius arc_r, each centered at the OPPOSITE
    springer) meeting at a sharp apex over piers of height pier_h — the
    PALE CHOIR ruin read. Consecutive duplicate points are dropped so the
    band never builds a zero-length segment.
    """
    sx = span / 2.0
    th_a = math.acos(-sx / arc_r)   # apex angle on the springer-centered arcs
    pts: list = []

    def add(p):
        if not pts or (p - pts[-1]).length > 1e-4:
            pts.append(p)

    add(Vector((-sx, 0.0, 0.0)))    # left pier foot
    add(Vector((-sx, 0.0, pier_h)))  # left springer
    for k in range(arc_steps + 1):  # left limb: theta 180 -> th_a
        th = math.pi - (math.pi - th_a) * k / arc_steps
        add(Vector((sx + arc_r * math.cos(th), 0.0,
                    pier_h + arc_r * math.sin(th))))
    for k in range(1, arc_steps + 1):  # right limb: theta (180-th_a) -> 0
        th = (math.pi - th_a) * (1.0 - k / arc_steps)
        add(Vector((-sx + arc_r * math.cos(th), 0.0,
                    pier_h + arc_r * math.sin(th))))
    add(Vector((sx, 0.0, 0.0)))     # right pier foot
    return pts


def add_shard(bm, pos, r, h, tilt, yaw, rng):
    """4-sided predatory spike (quad base ring + apex) — same as
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


def add_crystal_broken(bm, pos, r, h_top, h_bot, rng, tilt=0.0, yaw=0.0):
    """Hex crystal with a SNAPPED tip (broken-spire read) — the glass_spire
    sibling recipe (forge_library.py verbatim). Mid ring at local z=0, shaft
    up to a jagged n-gon cap, prism tail down to -h_bot (buried by the
    caller so the plinth alone defines the base plane). ~32 tris."""
    before = set(bm.verts)
    sides = 6
    mid, top, tail = [], [], []
    for i in range(sides):
        a = math.pi * 2.0 * i / sides + rng.uniform(-0.08, 0.08)
        rr = r * rng.uniform(0.85, 1.15)
        mid.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr,
                                 rng.uniform(-0.03, 0.03))))
        aa = a + rng.uniform(-0.12, 0.12)
        rr2 = r * 0.32 * rng.uniform(0.7, 1.25)
        top.append(bm.verts.new((math.cos(aa) * rr2, math.sin(aa) * rr2,
                                 h_top * rng.uniform(0.94, 1.0))))
        tail.append(bm.verts.new((math.cos(a) * rr * 0.92,
                                  math.sin(a) * rr * 0.92, -h_bot)))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((mid[i], mid[j], top[i], top[j]))      # shaft
        bm.faces.new((tail[j], tail[i], mid[i], mid[j]))    # buried tail
    bm.faces.new(top)                                       # snapped cap
    bm.faces.new(tuple(reversed(tail)))                     # buried end cap
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    verts = [v for v in bm.verts if v not in before]
    mat = (Matrix.Translation(pos)
           @ Matrix.Rotation(yaw, 4, "Z")
           @ Matrix.Rotation(tilt, 4, "X"))
    bmesh.ops.transform(bm, matrix=mat, verts=verts)


# ------------------------------------------------------------- asset builds --

def build_rib_arch(coll):
    """PALE CHOIR arch — 2 interlocking pointed rib bands swept along
    gothic-arc paths (tapered radius, progressive twist, offset in depth so
    they cross at the crown) + 3 keystone shards wedged at the apex.
    One bmesh, overlapping solids (bands interpenetrate at the keystone)."""
    mesh = bpy.data.meshes.new("rib_arch")
    bm = bmesh.new()
    bands = [
        # (span, pier_h, arc_r, y_off, r0, r1, twist0, twist1, phase)
        (3.00, 1.10, 3.00, -0.13, 0.170, 0.105, 0.00, 0.85, 0.00),
        (2.86, 1.04, 2.86, +0.13, 0.150, 0.095, 0.40, 1.25, 0.50),
    ]
    for (span, pier_h, arc_r, y_off, r0, r1, tw0, tw1, ph) in bands:
        path = [Vector((p.x, y_off + rng_uniform(-0.015, 0.015), p.z))
                for p in arch_path(span, pier_h, arc_r, 4)]
        arc_band(bm, path, sides=3, r0=r0, r1=r1, jitter=0.10, rng=RNG,
                 twist0=tw0, twist1=tw1, phase=ph)
    # 3 keystone shards — crown spike + 2 hanging spurs crossing both bands
    add_shard(bm, (0.00, 0.00, 3.60), 0.09, 0.55, -0.15, 0.0, RNG)
    add_shard(bm, (0.16, 0.00, 3.35), 0.08, 0.50, 2.35, -math.pi / 2, RNG)
    add_shard(bm, (-0.16, 0.00, 3.35), 0.08, 0.50, 2.35, math.pi / 2, RNG)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("rib_arch", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.018, 1)
    fit_dims(obj, 5.0, 3.2, anchor="base")
    return obj


def build_bone_spire(coll):
    """PALE CHOIR spire — 4 snapped bone-glass needles (glass_spire sibling
    recipe, hex crystals with severed tips) on a fractured pentagon plinth.
    Needle tails end ABOVE the plinth bottom, so the plinth alone defines
    the base plane (anchor="base" = plinth on the floor, no floating base)."""
    mesh = bpy.data.meshes.new("bone_spire")
    bm = bmesh.new()
    # fractured plinth: jittered pentagon slab, 2 rings
    ring_stack(bm, [(0.00, 1.05, 0.00, 0.00, 0.00),
                    (0.30, 0.88, 0.00, 0.00, 0.18)],
               sides=5, jitter=0.10, rng=RNG)
    layout = [
        # (x, y, r, h_top, h_bot, tilt, yaw) — anchors INSIDE the plinth
        (0.08, 0.05, 0.30, 3.30, 0.24, 0.08, 0.0),    # hero needle
        (-0.30, -0.18, 0.22, 2.30, 0.20, 0.20, 2.2),  # leaning shard
        (0.32, -0.22, 0.19, 1.70, 0.18, 0.26, -0.9),
        (-0.28, 0.30, 0.15, 1.15, 0.16, 0.32, 2.8),   # low broken stub
    ]
    for (x, y, r, ht, hb, tilt, yaw) in layout:
        add_crystal_broken(bm, (x + rng_uniform(-0.03, 0.03),
                                y + rng_uniform(-0.03, 0.03),
                                0.26),
                           r, ht, hb, RNG, tilt=tilt, yaw=yaw)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("bone_spire", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.020, 1)
    fit_dims(obj, 4.6, 2.4, anchor="base")
    return obj


def build_pipe_organ_cluster(coll):
    """PALE CHOIR organ — 7 graded square tapered pipes (4-sided ring
    stacks; graded heights, tallest dead center) on a chest plinth. The
    hero pipe carries a mitered lip cap (flared + angled top ring). One
    bmesh, pipe bases buried in the chest."""
    mesh = bpy.data.meshes.new("pipe_organ_cluster")
    bm = bmesh.new()
    # chest plinth: axis-aligned square slab (phase pi/4 = flat faces on x/y)
    ring_stack(bm, [(0.00, 1.70, 0.00, 0.00, 0.00),
                    (0.40, 1.56, 0.00, 0.00, 0.10)],
               sides=4, jitter=0.05, rng=RNG, phase=math.pi / 4)
    heights = [1.70, 2.40, 3.05, 3.45, 3.05, 2.40, 1.70]
    for k, ph_h in enumerate(heights):
        px = -0.99 + 0.33 * k
        hero = (k == 3)
        pr = 0.21 if hero else 0.185
        prof = [(0.34, pr, px, 0.02, RNG.uniform(0.0, math.pi)),
                (0.34 + ph_h, pr * 0.78, px, -0.02, RNG.uniform(0.0, math.pi))]
        if hero:
            prof.insert(1, (0.34 + ph_h * 0.6, pr * 0.9, px, 0.0, 0.25))
        rings = ring_stack(bm, prof, sides=4, jitter=0.05, rng=RNG,
                           phase=0.0 if hero else RNG.uniform(0.0, math.pi))
        if hero:
            for v in rings[-1]:        # mitered lip: flare + angled cap
                v.co.x += (v.co.x - px) * 0.38
                v.co.z += 0.075 if v.co.x < px else -0.075
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("pipe_organ_cluster", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.020, 1)
    fit_dims(obj, 3.8, 2.6, anchor="base")
    return obj


def build_reliquary_lantern(coll):
    """PALE CHOIR lantern — obsidian reliquary box (3-ring square shell with
    a stepped lid), inner bone-glass core prism poking through the lid, 4
    corner finial shards. One bmesh, overlapping solids."""
    mesh = bpy.data.meshes.new("reliquary_lantern")
    bm = bmesh.new()
    # obsidian box: base, shoulder, stepped lid (axis-aligned square)
    ring_stack(bm, [(0.00, 0.95, 0.00, 0.00, 0.00),
                    (1.35, 0.95, 0.00, 0.00, 0.12),
                    (1.72, 0.72, 0.00, 0.00, 0.26)],
               sides=4, jitter=0.04, rng=RNG, phase=math.pi / 4)
    # inner bone-glass core prism (pokes above the lid)
    ring_stack(bm, [(0.15, 0.36, 0.00, 0.00, 0.40),
                    (1.95, 0.26, 0.00, 0.00, 0.90)],
               sides=4, jitter=0.06, rng=RNG, phase=math.pi / 4)
    # 4 corner finial shards on the lid shoulders
    for k in range(4):
        yaw = math.pi / 4.0 + k * math.pi / 2.0
        px, py = math.cos(yaw) * 0.50, math.sin(yaw) * 0.50
        add_shard(bm, (px, py, 1.55), 0.075, 0.55, 0.18, yaw, RNG)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("reliquary_lantern", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.022, 1)
    fit_dims(obj, 2.2, 1.4, anchor="base")
    return obj


def build_choir_pulpit(coll):
    """PALE CHOIR pulpit — tapered hex drum (ring_stack 6 sides x 3 rings,
    progressive twist = chiseled stone read) + 2 shard sounding wings
    splaying outward from the upper drum."""
    mesh = bpy.data.meshes.new("choir_pulpit")
    bm = bmesh.new()
    ring_stack(bm, [(0.00, 0.78, 0.00, 0.00, 0.00),
                    (1.45, 0.66, 0.02, -0.02, 0.35),
                    (2.55, 0.50, 0.00, 0.00, 0.70)],
               sides=6, jitter=0.07, rng=RNG)
    add_shard(bm, (0.52, 0.00, 1.95), 0.10, 0.78, 0.55, -math.pi / 2, RNG)
    add_shard(bm, (-0.52, 0.00, 1.95), 0.10, 0.78, 0.55, math.pi / 2, RNG)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("choir_pulpit", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.022, 1)
    fit_dims(obj, 2.8, 1.8, anchor="base")
    return obj


# --------------------------------------------------------------- the build --

bpy.ops.wm.read_factory_settings(use_empty=True)

BUILDERS = [
    ("rib_arch", build_rib_arch),
    ("bone_spire", build_bone_spire),
    ("pipe_organ_cluster", build_pipe_organ_cluster),
    ("reliquary_lantern", build_reliquary_lantern),
    ("choir_pulpit", build_choir_pulpit),
]

scene = bpy.context.scene
built = {}    # name -> collection
stats = {}    # name -> (tris, verts)
for name, build in BUILDERS:
    if ONLY and name not in ONLY:
        continue
    coll = bpy.data.collections.new(name)
    scene.collection.children.link(coll)
    obj = build(coll)
    built[name] = coll
    tris = tri_count(obj)
    stats[name] = (tris, len(obj.data.vertices))
    over = " TRI_OVER_BUDGET" if tris > BUDGETS[name] else ""
    print(f"FORGE_BUILD {name} tris={tris} verts={stats[name][1]} "
          f"budget={BUDGETS[name]}{over}")

# --------------------------------------------- batch export (unlink/link)  --
# Same community pattern as forge_library.py: everything is built already;
# for each asset, unlink all root collections from the scene, link ONLY the
# asset's collection, export the whole scene (= exactly that asset).

names = [n for n, _ in BUILDERS if n in built]
for name in names:
    for child in list(scene.collection.children):
        scene.collection.children.unlink(child)
    scene.collection.children.link(built[name])
    bpy.context.view_layer.update()
    path = os.path.join(OUT_DIR, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB",
                              export_apply=True)
    tris, verts = stats[name]
    print(f"FORGE_ASSET_OK {name}.glb tris={tris} verts={verts} "
          f"bytes={os.path.getsize(path)}")

print(f"FORGE_DONE count={len(names)} out={OUT_DIR} seed={SEED}")
