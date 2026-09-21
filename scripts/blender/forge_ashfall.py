"""HOLLOW SUN — forge_ashfall: Sprint 20-4b. Biome-1 "ASHFALL VESTIBULE"
ground-scatter prop family, forged through the same pipeline conventions as
forge_choir.py (Task 18-1) — one bpy pass, one named collection per asset,
batch glTF export, fixed seed -> BYTE-DETERMINISTIC output (md5 twice-run
law holds for static forges):

    - one bpy pass, one named collection per asset, batch glTF export
      (unlink/link root collections)
    - fixed seed -> deterministic, byte-identical output
    - beveled + flat-shaded (the EMBER RITE chiseled look)
    - geometry only (runtime owns materials)

    PROPS ARE NOT FOES: vertical convention — built along Blender **+Z**,
    base at z=0 (forge_choir.py prop law), anchor="base". The foe
    snout-forward law does NOT apply to props (no forward-facing claim).
    Ground-scatter scale: 0.8–2.4u tall per the 20-4b spec.

    cinder_rubble     — broken hex slab cluster: 4 tilted hex slabs
                        (2-ring stacks, buried edges) + 2 cinder shards.
                        h 0.8, footprint 1.7, <= 500 tris.
    ash_dune_rock     — wind-carved rock: 5-sided sheared stack (progressive
                        cx drift = the dune-carve read) + 2 pebbles + 1
                        spall shard. h 1.3, footprint 1.9, <= 500 tris.
    fallen_monolith   — tilted broken monolith shard: 4-sided tapering
                        column with a jagged snapped crown, leaned 0.55 rad,
                        impact debris at the base. h 2.4, footprint 2.3,
                        <= 500 tris.

    GEOMETRY-NODES LESSON (sprint 18 brief, still law): every modifier is
    APPLIED via apply_mods() BEFORE tri_count(), and the export runs with
    export_apply=True — bake, then quantify, then verify. House style
    builds via bmesh directly (deterministic, no generator state
    divergence).

Run:
    blender -b -P scripts/blender/forge_ashfall.py -- out public/assets/meshes
    blender -b -P scripts/blender/forge_ashfall.py -- out public/assets/meshes --only cinder_rubble

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

# triangle budgets (20-4b contract: scatter stones <= 500)
BUDGETS = {
    "cinder_rubble": 500,
    "ash_dune_rock": 500,
    "fallen_monolith": 500,
}

# ----------------------------------------------------------------- helpers --
# (same conventions as forge_choir.py / forge_library.py)


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
    progressive twist = the gnarled/chiseled read. Returns the list of rings."""
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


def add_slab_hex(bm, pos, r, h, tilt, yaw, rng):
    """Broken hex slab (the rubble unit): 2-ring hex stack (radius jitter +
    flat cap) built along local +Z, tilted by `tilt`, yawed, placed at
    `pos`. Edges bury into the cluster neighbors. ~16 tris."""
    before = set(bm.verts)
    rings = ring_stack(bm, [(0.00, r, 0.00, 0.00, 0.00),
                            (h, r * rng.uniform(0.86, 0.96), 0.00, 0.00,
                             rng.uniform(0.0, 0.35))],
                       sides=6, jitter=0.09, rng=rng)
    verts = [v for ring in rings for v in ring]
    mat = (Matrix.Translation(pos)
           @ Matrix.Rotation(yaw, 4, "Z")
           @ Matrix.Rotation(tilt, 4, "X"))
    bmesh.ops.transform(bm, matrix=mat, verts=verts)


# ------------------------------------------------------------- asset builds --

def build_cinder_rubble(coll):
    """ASHFALL rubble — broken hex slab cluster: 4 tilted cracked slabs
    (hero + 3 satellites, edges interpenetrating) + 2 cinder shards poking
    from the seams. One bmesh, overlapping solids."""
    mesh = bpy.data.meshes.new("cinder_rubble")
    bm = bmesh.new()
    layout = [
        # (x, y, z, r, h, tilt, yaw)
        (0.10, -0.05, 0.10, 0.62, 0.16, 0.06, 0.20),   # hero slab
        (-0.42, 0.30, 0.05, 0.45, 0.13, -0.10, 1.40),  # cracked second
        (0.38, 0.42, 0.03, 0.36, 0.11, 0.14, 2.60),
        (-0.30, -0.38, 0.03, 0.30, 0.10, -0.08, 4.10),
    ]
    for (x, y, z, r, h, tilt, yaw) in layout:
        add_slab_hex(bm, (x + rng_uniform(-0.03, 0.03),
                          y + rng_uniform(-0.03, 0.03), z),
                     r, h, tilt, yaw, RNG)
    add_shard(bm, (0.20, 0.10, 0.10), 0.06, 0.30, 0.30, 0.6, RNG)
    add_shard(bm, (-0.12, -0.22, 0.08), 0.05, 0.22, -0.40, 2.1, RNG)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("cinder_rubble", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.018, 1)
    fit_dims(obj, 0.8, 1.7, anchor="base")
    return obj


def build_ash_dune_rock(coll):
    """ASHFALL dune rock — wind-carved: 5-sided sheared stack whose center
    drifts +X with height (the dune-carve read), 2 half-buried pebbles, 1
    wind-spall shard. One bmesh, overlapping solids."""
    mesh = bpy.data.meshes.new("ash_dune_rock")
    bm = bmesh.new()
    # main body: (z, r, cx, cy, twist) — progressive cx drift = shear
    ring_stack(bm, [(0.00, 0.80, 0.00, 0.00, 0.00),
                    (0.42, 0.92, 0.10, 0.02, 0.25),
                    (0.88, 0.78, 0.20, 0.05, 0.55),
                    (1.25, 0.52, 0.28, 0.04, 0.85)],
               sides=5, jitter=0.14, rng=RNG)
    # half-buried pebbles
    ring_stack(bm, [(0.00, 0.22, -0.55, 0.35, 0.30),
                    (0.18, 0.18, -0.55, 0.35, 0.55)],
               sides=5, jitter=0.10, rng=RNG)
    ring_stack(bm, [(0.00, 0.17, 0.45, -0.45, 0.10),
                    (0.12, 0.14, 0.45, -0.45, 0.30)],
               sides=5, jitter=0.10, rng=RNG)
    # wind spall shard riding the shear face
    add_shard(bm, (0.25, 0.30, 0.90), 0.07, 0.40, -0.50, 0.9, RNG)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("ash_dune_rock", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.020, 1)
    fit_dims(obj, 1.3, 1.9, anchor="base")
    return obj


def build_fallen_monolith(coll):
    """ASHFALL monolith — tilted broken shard: 4-sided tapering column with
    a jagged snapped crown, leaned 0.55 rad (the fallen read), 2 impact
    shards + 1 slab chunk at the base. One bmesh, overlapping solids
    (debris half-buried at the fall line)."""
    mesh = bpy.data.meshes.new("fallen_monolith")
    bm = bmesh.new()
    before = set(bm.verts)
    rings = ring_stack(bm, [(0.00, 0.55, 0.00, 0.00, 0.00),
                            (0.85, 0.52, 0.01, 0.00, 0.06),
                            (1.75, 0.47, 0.03, 0.01, 0.14),
                            (2.45, 0.30, 0.05, 0.02, 0.24),
                            (2.62, 0.13, 0.06, 0.02, 0.30)],
                       sides=4, jitter=0.16, rng=RNG, phase=math.pi / 4)
    # lean the column (fallen read): tilt about X then yaw about Z
    verts = [v for ring in rings for v in ring]
    mat = (Matrix.Rotation(0.35, 4, "Z")
           @ Matrix.Rotation(0.55, 4, "X"))
    bmesh.ops.transform(bm, matrix=mat, verts=verts)
    # impact debris at the fall line (built from z=0, half-buried)
    add_shard(bm, (0.45, -0.35, 0.00), 0.08, 0.22, 0.25, 0.7, RNG)
    add_shard(bm, (-0.50, 0.30, 0.00), 0.07, 0.18, -0.30, 2.4, RNG)
    ring_stack(bm, [(0.00, 0.24, 0.62, 0.28, 0.00),
                    (0.12, 0.20, 0.62, 0.28, 0.10)],
               sides=4, jitter=0.10, rng=RNG)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("fallen_monolith", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.022, 1)
    fit_dims(obj, 2.4, 2.3, anchor="base")
    return obj


# --------------------------------------------------------------- the build --

bpy.ops.wm.read_factory_settings(use_empty=True)

BUILDERS = [
    ("cinder_rubble", build_cinder_rubble),
    ("ash_dune_rock", build_ash_dune_rock),
    ("fallen_monolith", build_fallen_monolith),
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
# Same community pattern as forge_choir.py: everything is built already;
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
