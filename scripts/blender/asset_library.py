"""HOLLOW SUN — tier-2 asset LIBRARY (pipeline v2, PLAYBOOK §6 upgrade #2).

ONE bpy script that builds ALL tier-2 assets into named collections and
batch-exports each collection to its own .glb (community pattern: build
everything, then unlink/link root collections and export one at a time).

Run:
    blender -b -P scripts/blender/asset_library.py -- out public/assets/meshes
    blender -b -P scripts/blender/asset_library.py -- out public/assets/meshes --only obelisk,shard_cluster

Arguments (after `--`):
    out DIR        output directory for .glb files (default: public/assets/meshes)
    --only a,b     export only these assets (comma separated)
    --seed N       override the fixed seed (default 42 — re-run is byte-identical)

Library (EMBER RITE: dark obsidian, faceted/chiseled, warm ember rims):
    obelisk          — the original tier-2 asset (quality bar folded in from
                       scripts/blender/obelisk.py, which this script SUPERSEDES;
                       obelisk.py is kept runnable for one-off use)
    monolith_cracked — NEW: biome monolith variant, jagged crown + ember-vein
                       crack cuts (boolean difference)
    inlay_hex        — NEW: floor inlay hex tile (plate + raised core + 6 studs)
    warden_slab      — NEW: warden titan slab (boss-scale stacked monolith)
    shard_cluster    — NEW: rock base with a cluster of crystal shards

All randomness flows through a fixed seed → deterministic, byte-similar output.
Every asset is beveled + flat-shaded (the EMBER RITE chiseled look).
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

# ----------------------------------------------------------------- helpers --


def adopt(obj, coll):
    """Move an object into a collection (unlinks from any current one)."""
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)


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


def boolean(target, cutter, operation="DIFFERENCE"):
    bpy.context.view_layer.update()
    mod = target.modifiers.new("cut", "BOOLEAN")
    mod.operation = operation
    mod.object = cutter
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    bpy.context.view_layer.update()


def new_box(size, loc, rot=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.context.view_layer.update()
    return o


def union_into(keep, parts):
    """Boolean-union every part into keep (clean single solid), removing sources."""
    for p in parts:
        if p.name in bpy.data.objects:
            boolean(keep, p, "UNION")
    return keep


def join_objs(objs, name, coll):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    adopt(obj, coll)
    return obj


def add_crystal(bm, pos, r, h_top, h_bot, rng):
    """Hexagonal bipyramid crystal appended into bmesh, seeded jitter + tilt."""
    before = set(bm.verts)
    top = bm.verts.new((0.0, 0.0, h_top))
    bot = bm.verts.new((0.0, 0.0, -h_bot))
    ring = []
    for i in range(6):
        a = math.pi * 2.0 * i / 6.0 + rng.uniform(-0.08, 0.08)
        rr = r * rng.uniform(0.85, 1.15)
        ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr,
                                  rng.uniform(-0.03, 0.03))))
    for i in range(6):
        j = (i + 1) % 6
        bm.faces.new((top, ring[i], ring[j]))
        bm.faces.new((bot, ring[j], ring[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    verts = [v for v in bm.verts if v not in before]
    mat = (Matrix.Translation(pos)
           @ Matrix.Rotation(rng.uniform(0.0, math.pi * 2.0), 4, "Z")
           @ Matrix.Rotation(rng.uniform(-0.30, 0.30), 4, "X")
           @ Matrix.Rotation(rng.uniform(-0.30, 0.30), 4, "Y"))
    bmesh.ops.transform(bm, matrix=mat, verts=verts)


# ------------------------------------------------------------- asset builds --

def build_obelisk(coll):
    """Folded in from scripts/blender/obelisk.py — identical quality bar."""
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.42, radius2=0.10, depth=1.6)
    obj = bpy.context.active_object
    obj.name = "obelisk"
    obj.data.name = "obelisk"
    adopt(obj, coll)
    bevel(obj, 0.045, 2)
    return obj


def build_monolith_cracked(coll):
    """NEW — biome monolith variant: taper, jagged crown, ember-vein cracks."""
    mesh = bpy.data.meshes.new("monolith_cracked")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.36, 0.26, 0.85), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0.0, 0.0, 0.85), verts=bm.verts)  # base at z=0
    top = [v for v in bm.verts if v.co.z > 1.10]
    bmesh.ops.scale(bm, vec=(0.62, 0.66, 1.0), verts=top)          # taper
    bmesh.ops.translate(bm, vec=(0.03, 0.0, 0.0), verts=top)       # lean
    for v in top:                                                  # jagged crown
        v.co.z += rng_uniform(-0.12, 0.07)
        v.co.x += rng_uniform(-0.03, 0.03)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("monolith_cracked", mesh)
    coll.objects.link(obj)
    # ember-vein gouges. v3 after two VLM inspect rounds: v1 full-depth
    # through-cuts read like "holes"; v2 kept narrow cutters (0.012-0.02 wide)
    # under a 0.015 bevel — bevel wider than the cutter walls → degenerate
    # self-intersecting bevel trash that rendered as bright white slivers.
    # v3: chunkier footprint (0.36x0.26, kills the "flat slab" read), FEW WIDE
    # gouges (0.05-0.075, far above the 0.010 bevel width), three on the -Y
    # hero face + one on the +X face so the 3/4 camera sees cracks on both.
    slots = [
        (-0.08, 0.50, (0.0, math.radians(30.0), math.radians(10.0))),
        (0.07, 0.88, (0.0, math.radians(-32.0), math.radians(-8.0))),
        (-0.04, 1.18, (math.radians(12.0), math.radians(14.0), 0.0)),
    ]
    for (x, z, rot) in slots:
        cutter = new_box((rng_uniform(0.05, 0.075), 0.16, rng_uniform(0.04, 0.06)),
                         (x, -0.13, z), rot)
        boolean(obj, cutter, "DIFFERENCE")
    side = new_box((0.16, 0.055, 0.045), (0.19, 0.02, 0.75),
                   (math.radians(20.0), 0.0, math.radians(65.0)))
    boolean(obj, side, "DIFFERENCE")
    bevel(obj, 0.010, 1)
    return obj


def build_inlay_hex(coll):
    """NEW — floor inlay hex tile: plate + raised core + 6 corner studs."""
    rot30 = math.pi / 6.0
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.50, depth=0.05,
                                        location=(0, 0, 0.025), rotation=(0, 0, rot30))
    parts.append(bpy.context.active_object)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.31, depth=0.05,
                                        location=(0, 0, 0.07), rotation=(0, 0, rot30))
    parts.append(bpy.context.active_object)
    for i in range(6):
        a = math.pi * 2.0 * i / 6.0 + rot30
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.045, radius2=0.0,
                                        depth=0.11,
                                        location=(math.cos(a) * 0.41, math.sin(a) * 0.41, 0.10))
        parts.append(bpy.context.active_object)
    for p in parts:
        adopt(p, coll)
    # union the raised core + studs into the plate → one clean solid
    keep = union_into(parts[0], parts[1:])
    keep.name = "inlay_hex"
    keep.data.name = "inlay_hex"
    bevel(keep, 0.006, 2)
    return keep


def build_warden_slab(coll):
    """NEW — warden titan slab: boss-scale stacked monolith, seeded lean/jitter."""
    parts = []
    # stacked blocks deliberately overlap by >=5mm so the unions weld cleanly
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.07))
    plinth = bpy.context.active_object          # z 0.00 .. 0.14
    plinth.scale = (0.52, 0.36, 0.14)
    parts.append(plinth)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.66))
    column = bpy.context.active_object          # z 0.135 .. 1.185
    column.scale = (0.30, 0.18, 1.05)
    parts.append(column)
    lean = rng_uniform(-0.04, 0.04)
    column.location.x = lean
    for sx in (-1.0, 1.0):
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        sh = bpy.context.active_object          # z 1.01 .. 1.31, overlaps column
        sh.scale = (0.14, 0.15, 0.30)
        sh.location = (sx * 0.20 + lean + rng_uniform(-0.02, 0.02), 0.0, 1.16)
        sh.rotation_euler = (0.0, 0.0, rng_uniform(-0.08, 0.08))
        parts.append(sh)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(lean, 0, 1.36))
    crown = bpy.context.active_object           # z 1.24 .. 1.48, overlaps shoulders
    crown.scale = (0.36, 0.22, 0.24)
    parts.append(crown)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(lean, 0, 1.54))
    cap = bpy.context.active_object             # z 1.46 .. 1.62, overlaps crown
    cap.scale = (0.16, 0.14, 0.16)
    parts.append(cap)
    for p in parts:
        adopt(p, coll)
    keep = union_into(plinth, parts[1:])
    keep.name = "warden_slab"
    keep.data.name = "warden_slab"
    bpy.context.view_layer.update()
    bevel(keep, 0.03, 2)
    return keep


def build_shard_cluster(coll):
    """NEW — rock base + seeded cluster of crystal shards (pickup/emitter prop)."""
    mesh = bpy.data.meshes.new("shard_cluster")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.30)
    for v in bm.verts:  # rocky jitter
        v.co += Vector((rng_uniform(-0.03, 0.03),
                        rng_uniform(-0.03, 0.03),
                        rng_uniform(-0.03, 0.03)))
    bmesh.ops.scale(bm, vec=(1.15, 0.90, 0.52), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0.0, 0.0, 0.17), verts=bm.verts)
    layout = [
        (0.00, 0.00, 0.30, 0.085, 0.52, 0.16),   # hero shard
        (0.13, 0.06, 0.26, 0.060, 0.30, 0.12),
        (-0.12, 0.09, 0.27, 0.055, 0.26, 0.11),
        (0.05, -0.13, 0.25, 0.050, 0.22, 0.10),
        (-0.06, -0.10, 0.28, 0.042, 0.18, 0.09),
        (0.14, -0.05, 0.24, 0.038, 0.15, 0.08),
    ]
    for (x, y, z, r, ht, hb) in layout:
        add_crystal(bm, (x + rng_uniform(-0.02, 0.02),
                         y + rng_uniform(-0.02, 0.02),
                         z + rng_uniform(-0.02, 0.02)),
                    r, ht, hb, RNG)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("shard_cluster", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.006, 1)
    return obj


# --------------------------------------------------------------- the build --

bpy.ops.wm.read_factory_settings(use_empty=True)

BUILDERS = [
    ("obelisk", build_obelisk),
    ("monolith_cracked", build_monolith_cracked),
    ("inlay_hex", build_inlay_hex),
    ("warden_slab", build_warden_slab),
    ("shard_cluster", build_shard_cluster),
]

scene = bpy.context.scene
built = {}    # name -> collection
verts = {}    # name -> vertex count after modifier apply
for name, build in BUILDERS:
    if ONLY and name not in ONLY:
        continue
    coll = bpy.data.collections.new(name)
    scene.collection.children.link(coll)
    obj = build(coll)
    built[name] = coll
    verts[name] = len(obj.data.vertices)
    print(f"LIBRARY_BUILD {name} verts={verts[name]}")

# --------------------------------------------- batch export (unlink/link)  --
# Community pattern: everything is built already; for each asset, unlink all
# root collections from the scene, link ONLY the asset's collection, export
# the whole scene (= exactly that asset), then move on.

names = [n for n, _ in BUILDERS if n in built]
for name in names:
    for child in list(scene.collection.children):
        scene.collection.children.unlink(child)
    scene.collection.children.link(built[name])
    bpy.context.view_layer.update()
    path = os.path.join(OUT_DIR, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True)
    print(f"LIBRARY_ASSET_OK {name}.glb verts={verts[name]} bytes={os.path.getsize(path)}")

print(f"ASSET_LIBRARY_DONE count={len(names)} out={OUT_DIR} seed={SEED}")
