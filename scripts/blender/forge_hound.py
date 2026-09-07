"""HOLLOW SUN — forge_hound: Task 15. Forges the CINDER HOUND body through
the same pipeline conventions as forge_library.py (Task 13-a):

    - one bpy pass, one named collection, batch glTF export (unlink/link)
    - fixed seed -> deterministic output
    - beveled + flat-shaded (the EMBER RITE chiseled look)
    - geometry only (runtime replaces materials with its own shader)

    cinder_hound — NEW charger body: a lean crouched quadruped wedge.
    HORIZONTAL body: rings stack along Blender **Y**, SNOUT toward **-Y**
    (the glTF +Y-up conversion maps Blender -Y -> glTF +Z = three.js forward,
    which is exactly the direction the in-game `face` yaw aims). 4 buried
    legs, blade tail, 4 spine ember-crack plates, 2 ears.
    Centered at origin (husk_drifter convention), height 2.0 (Blender Z),
    length 2.6 (Blender Y), <= 600 tris. The runtime re-normalizes height
    to 1.7 world units (k = 1.7 / bbox.y), landing the hound at ~1.7 tall
    and ~2.2 long — the fallback wedge footprint.

Run:
    blender -b -P scripts/blender/forge_hound.py -- out public/assets/meshes

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
SEED = int(arg_value("--seed", default="42"))
RNG = random.Random(SEED)

os.makedirs(OUT_DIR, exist_ok=True)

BUDGETS = {"cinder_hound": 600}


# ----------------------------------------------------------------- helpers --
# (same conventions as forge_library.py)

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


# --------------------------------------------------------------- the build --

bpy.ops.wm.read_factory_settings(use_empty=True)

BUILDERS = [("cinder_hound", build_cinder_hound)]

scene = bpy.context.scene
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
