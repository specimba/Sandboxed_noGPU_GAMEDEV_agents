"""HOLLOW SUN — forge_weaver: Task 16. Forges the HEX WEAVER body through
the same pipeline conventions as forge_hound.py (Task 15):

    - one bpy pass, one named collection, batch glTF export (unlink/link)
    - fixed seed -> deterministic output
    - beveled + flat-shaded (the EMBER RITE chiseled look)
    - geometry only (runtime replaces materials with its own shader)

    hex_weaver — the reworked HEX LOOM body (the zone-denial caster).
    A flat hexagonal lattice: outer hex ring (6-sided, the identity the old
    torus hinted at), 6 radiating spokes, a central hex hub, 3 crowned
    struts, and one hanging needle under the hub. No facing — the runtime
    spins the mesh (group yaw 0), so only the symmetric silhouette matters.
    Centered at origin (husk_drifter convention). The runtime re-normalizes
    the FOOTPRINT to 1.5 world units (k = 1.5 / max(bbox.x, bbox.y) after
    the glTF +Y-up conversion), matching the fallback torus ring (~1.62).

Run:
    blender -b -P scripts/blender/forge_weaver.py -- out public/assets/meshes

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

BUDGETS = {"hex_weaver": 600}


# ----------------------------------------------------------------- helpers --
# (same conventions as forge_hound.py / forge_library.py)

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
        (ca * r1 - sa * jw, sa * r1 + ca * jw, z - tz),
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


# --------------------------------------------------------------- the build --

bpy.ops.wm.read_factory_settings(use_empty=True)

BUILDERS = [("hex_weaver", build_hex_weaver)]

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
