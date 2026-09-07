"""HOLLOW SUN — forge_library: Task 13-a. The Blender pipeline FORGES NEW
game content (not re-runs of the tier-2 library) through the same pipeline
conventions as scripts/blender/asset_library.py:

    - one bpy pass builds every asset into its own named collection
    - batch glTF export per collection (unlink/link root collections)
    - fixed seed -> deterministic, byte-similar output
    - beveled + flat-shaded (the EMBER RITE chiseled look)
    - geometry only (runtime replaces materials with its own shader)

Run:
    blender -b -P scripts/blender/forge_library.py -- out public/assets/meshes
    blender -b -P scripts/blender/forge_library.py -- out public/assets/meshes --only husk_drifter

Arguments (after `--`):
    out DIR        output directory for .glb files (default: public/assets/meshes)
    --only a,b     export only these assets (comma separated)
    --seed N       override the fixed seed (default 42)

Forged assets (ships in-game):
    husk_drifter — NEW drifter body: gnarled ash husk, angular faceted obsidian
                   shell, tapered hunched silhouette + 4 shard spikes.
                   Centered at origin (caster-obelisk convention), height 2.2,
                   max width 1.7, <= 900 tris.
    glass_spire  — NEW biome-2 "GLASS HOLLOW" prop: broken crystal spire
                   cluster (5 snapped-tip spikes on a shattered rock base).
                   Base at y=0 (glTF), height 4.5, footprint 2.6, <= 700 tris.
    heart_root   — NEW biome-3 "THE HEART" prop: gnarled obsidian root pillar,
                   3 twisted root columns merging into one knurled trunk with
                   broken branch stumps. Base at y=0, height 5.2,
                   footprint 2.2, <= 900 tris.

Orientation note: built along Blender +Z with base at z=0 (or centered at
origin); the glTF exporter's default +Y-up conversion is what the runtime and
render_preview.py already expect (same as asset_library.py).
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

# triangle budgets (hard spec from Task 13-a)
BUDGETS = {
    "husk_drifter": 900,
    "glass_spire": 700,
    "heart_root": 900,
}

# ----------------------------------------------------------------- helpers --
# (same conventions as asset_library.py)


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


def tri_count(obj):
    """Final exported triangle count (glTF triangulates exactly like this)."""
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def fit_dims(obj, target_h, target_w=None, anchor="base"):
    """Normalize the mesh to the exact spec: uniform-scale to target height,
    optional x/y scale to target footprint, then re-anchor.

    anchor="base"  -> min z = 0, x/y centered   (props standing on the floor)
    anchor="center"-> bbox center at the origin (caster-obelisk convention)
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
          f"anchor={anchor} z=[{lo.z:.3f}..{hi.z:.3f}]")


def ring_stack(bm, profile, sides=6, jitter=0.0, rng=None, phase=0.0):
    """Append a closed faceted prism defined by a ring profile.

    profile: list of (z, radius, cx, cy, twist) — one hex (or n-gon) ring per
    entry, bridged bottom-to-top, both ends capped. Per-vertex radius jitter
    + progressive twist = the gnarled/chiseled read. Returns nothing; the
    caller keeps building into the same bmesh.
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


def add_shard(bm, pos, r, h, tilt, yaw, rng):
    """4-sided predatory spike (quad base ring + apex) for the ash husk.

    Built along local +Z from the origin, tilted by `tilt` around local X
    (apex leans toward +Y), then yawed around Z and placed at `pos`. 6 tris.
    """
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


def add_stump(bm, pos, r, length, tilt, yaw, rng):
    """Broken branch stump: 4-sided tapered prism with an angled snapped cap.

    Base buried at `pos` (trunk axis), leaning outward by `tilt` aimed by
    `yaw`. ~20 tris.
    """
    before = set(bm.verts)
    rings = []
    a0 = rng.uniform(0.0, math.pi)
    for (t, rr) in ((0.0, r), (0.55, r * 0.82), (1.0, r * 0.55)):
        ring = []
        for k in range(4):
            a = a0 + t * 0.7 + math.pi / 2.0 * k
            ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr,
                                      t * length)))
        rings.append(ring)
    for v in rings[-1]:                        # angled break across the cap
        v.co.y += length * 0.18
    for i in range(2):
        for k in range(4):
            k2 = (k + 1) % 4
            bm.faces.new((rings[i][k], rings[i][k2],
                          rings[i + 1][k2], rings[i + 1][k]))
    bm.faces.new(rings[-1])                   # snapped cap
    bm.faces.new(tuple(reversed(rings[0])))   # base cap (buried in the trunk)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    verts = [v for v in bm.verts if v not in before]
    mat = (Matrix.Translation(pos)
           @ Matrix.Rotation(yaw, 4, "Z")
           @ Matrix.Rotation(tilt, 4, "X"))
    bmesh.ops.transform(bm, matrix=mat, verts=verts)


def add_crystal_broken(bm, pos, r, h_top, h_bot, rng, tilt=0.0, yaw=0.0):
    """Hex crystal with a SNAPPED tip (broken-spire read) — biome-2 shard.

    Mid ring at local z=0 (emerges at the caller's anchor height), shaft up to
    a small top ring at h_top capped by a jagged n-gon = severed, not finished,
    plus a straight prism tail down to -h_bot (flat end cap). The tail is
    FULLY BURIED by the caller so the rock base stays the lowest geometry and
    anchor="base" lands the rock on the floor (no floating-base defect).
    ~32 tris. Same seeded-jitter + tilt/yaw placement as asset_library.py.
    """
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

def build_husk_drifter(coll):
    """NEW drifter body — gnarled ash husk: tapered hunched hex hull (progressive
    twist = gnarl), forward-leaning predator crown, 4 shard spikes (head crest,
    both shoulders, dorsal). Overlapping shells in ONE bmesh, exactly like the
    shipped build_shard_cluster convention (spike bases buried in the hull)."""
    mesh = bpy.data.meshes.new("husk_drifter")
    bm = bmesh.new()
    profile = [
        (-1.10, 0.16, 0.00, 0.02, 0.00),   # blunt drifting foot
        (-0.72, 0.55, 0.00, 0.00, 0.10),
        (-0.25, 0.78, 0.02, 0.05, 0.22),   # hips — widest band
        (0.25, 0.72, 0.04, 0.14, 0.40),    # chest, leaning forward (+Y)
        (0.68, 0.50, 0.02, 0.27, 0.58),    # shoulders
        (0.95, 0.28, -0.02, 0.35, 0.78),   # hunched neck
        (1.10, 0.13, 0.00, 0.40, 1.00),    # forward-thrust crown
    ]
    ring_stack(bm, profile, sides=6, jitter=0.10, rng=RNG)
    shards = [
        # (pos, r, h, tilt, yaw) — yaw aims the outward lean
        ((0.00, 0.46, 1.04), 0.10, 0.55, 0.38, 0.0),          # head crest
        ((0.46, 0.26, 0.66), 0.12, 0.62, 0.55, -math.pi / 2),  # R shoulder
        ((-0.44, 0.28, 0.70), 0.11, 0.70, 0.60, math.pi / 2),  # L shoulder
        ((0.02, -0.16, 0.80), 0.10, 0.52, 0.50, math.pi),      # dorsal spike
    ]
    for (pos, r, h, tilt, yaw) in shards:
        add_shard(bm, pos, r, h, tilt, yaw, RNG)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("husk_drifter", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.030, 1)
    fit_dims(obj, 2.2, 1.7, anchor="center")
    return obj


def build_glass_spire(coll):
    """NEW biome-2 "GLASS HOLLOW" prop — shattered rock base + 5 angled
    crystal spikes with snapped tips, varying heights (hero ~4.5). One bmesh,
    crystal bottoms buried in the rock (shard_cluster convention)."""
    mesh = bpy.data.meshes.new("glass_spire")
    bm = bmesh.new()
    # shattered base rock: one jittered icosphere, flattened
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.5)
    for v in bm.verts:
        v.co += Vector((rng_uniform(-0.05, 0.05),
                        rng_uniform(-0.05, 0.05),
                        rng_uniform(-0.05, 0.05)))
    bmesh.ops.scale(bm, vec=(1.30, 1.05, 0.42), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0.0, 0.0, 0.23), verts=bm.verts)
    layout = [
        # (x, y, r, h_top, h_bot, tilt, yaw) — anchors sit INSIDE the rock's
        # upper half and every tail ends ABOVE the rock bottom, so the rock
        # alone defines the base plane (anchor="base" = rock on the floor).
        (0.06, 0.04, 0.30, 3.85, 0.22, 0.10, 0.0),    # hero spire
        (-0.24, -0.16, 0.22, 2.75, 0.18, 0.22, 2.2),  # leaning shard
        (0.28, -0.20, 0.19, 2.05, 0.16, 0.26, -0.9),
        (-0.24, 0.30, 0.16, 1.45, 0.14, 0.30, 2.8),
        (0.26, 0.28, 0.13, 0.90, 0.12, 0.34, 1.4),    # low broken stub
    ]
    for (x, y, r, ht, hb, tilt, yaw) in layout:
        add_crystal_broken(bm, (x + rng_uniform(-0.03, 0.03),
                                y + rng_uniform(-0.03, 0.03),
                                0.32),
                           r, ht, hb, RNG, tilt=tilt, yaw=yaw)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("glass_spire", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.010, 1)
    fit_dims(obj, 4.5, 2.6, anchor="base")
    return obj


def build_heart_root(coll):
    """NEW biome-3 "THE HEART" prop — gnarled obsidian root pillar: one twisted
    tapered trunk (progressive twist + jitter) merged with 3 splayed buttress
    root columns and 3 broken branch stumps. Overlapping solids in one bmesh
    (all stumps/roots rooted well inside the trunk walls)."""
    mesh = bpy.data.meshes.new("heart_root")
    bm = bmesh.new()
    trunk_profile = [
        (0.00, 0.55, 0.00, 0.00, 0.00),   # flared base
        (0.55, 0.46, 0.04, -0.03, 0.20),
        (1.30, 0.38, -0.03, 0.05, 0.42),
        (2.20, 0.31, 0.05, 0.02, 0.62),
        (3.20, 0.24, -0.03, -0.04, 0.80),
        (4.10, 0.17, 0.03, 0.03, 0.96),
        (4.75, 0.10, 0.00, 0.00, 1.10),
        (5.00, 0.04, 0.02, 0.02, 1.22),   # jagged crown tip
    ]
    ring_stack(bm, trunk_profile, sides=6, jitter=0.09, rng=RNG)
    # 3 buttress roots splaying from the base, merging into the trunk by z~1.6
    for k in range(3):
        th = math.pi * 0.5 + k * (2.0 * math.pi / 3.0)
        dx, dy = math.cos(th), math.sin(th)
        prof = []
        for (z, off, r, tw) in ((0.00, 0.72, 0.26, 0.00),
                                (0.55, 0.50, 0.24, 0.25),
                                (1.10, 0.28, 0.22, 0.50),
                                (1.65, 0.10, 0.20, 0.75)):
            prof.append((z, r, dx * off, dy * off, tw))
        ring_stack(bm, prof, sides=6, jitter=0.12, rng=RNG,
                   phase=rng_uniform(0.0, math.pi * 2.0))
    # broken branch stumps along the trunk (angle aimed by yaw)
    stumps = [
        (2.30, 0.11, 0.55, 1.05, 0.4),
        (3.35, 0.09, 0.42, 1.15, 2.5),
        (4.30, 0.07, 0.30, 0.85, 4.4),
    ]
    for (z, r, length, tilt, yaw) in stumps:
        add_stump(bm, (0.0, 0.0, z), r, length, tilt, yaw, RNG)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("heart_root", mesh)
    coll.objects.link(obj)
    bevel(obj, 0.022, 1)
    fit_dims(obj, 5.2, 2.2, anchor="base")
    return obj


# --------------------------------------------------------------- the build --

bpy.ops.wm.read_factory_settings(use_empty=True)

BUILDERS = [
    ("husk_drifter", build_husk_drifter),
    ("glass_spire", build_glass_spire),
    ("heart_root", build_heart_root),
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
# Same community pattern as asset_library.py: everything is built already;
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
