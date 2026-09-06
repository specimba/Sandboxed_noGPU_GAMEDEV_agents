"""HOLLOW SUN — render→inspect loop step 1 (pipeline v2, PLAYBOOK §6 upgrade #1).

For each exported .glb: import into an empty scene, frame the camera, render
ONE preview PNG to <out>/<name>.png. Designed for the CPU-only sandbox:
  primary  engine BLENDER_WORKBENCH (viewport-style studio shading, fast)
  fallback engine CYCLES device='CPU' samples=24 at 320px
Run under raw Xvfb + LIBGL_ALWAYS_SOFTWARE=1 (xvfb-run is broken in this
sandbox — no xauth; see scripts/render_previews.sh which owns the display).

Run:
    Xvfb :77 & DISPLAY=:77 LIBGL_ALWAYS_SOFTWARE=1 \
      blender -b -P scripts/blender/render_preview.py -- \
        --out .qa/assets --meshes public/assets/meshes [--engine workbench|cycles|auto]

Markers: RENDER_OK <name> <engine> <path> per asset, PREVIEWS_DONE ok=N.
"""
import bpy
import math
import os
import sys

from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg_value(*flags, default=None):
    for f in flags:
        if f in argv:
            i = argv.index(f)
            if i + 1 < len(argv):
                return argv[i + 1]
    return default


OUT_DIR = arg_value("--out", default=".qa/assets")
MESH_DIR = arg_value("--meshes", default="public/assets/meshes")
ENGINE_MODE = (arg_value("--engine", default="auto") or "auto").lower()  # auto|workbench|cycles
ONLY = arg_value("--only")
ONLY = set(x.strip() for x in ONLY.split(",") if x.strip()) if ONLY else None

CAM_DIR = Vector((1.0, -1.0, 0.55)).normalized()  # 3/4 hero view, Y-up glTF space
DARK_BG = (0.016, 0.015, 0.019)                   # near-black obsidian backdrop
STONE = (0.105, 0.098, 0.115)                     # cool dark stone for workbench

os.makedirs(OUT_DIR, exist_ok=True)
files = sorted(f for f in os.listdir(MESH_DIR) if f.endswith(".glb"))
if ONLY:
    files = [f for f in files if f[:-4] in ONLY]
if not files:
    print(f"PREVIEWS_DONE ok=0 (no .glb found in {MESH_DIR})")
    sys.exit(0)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def world_bbox(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    seen = False
    for o in objs:
        if o.type != "MESH":
            continue
        seen = True
        oe = o.evaluated_get(dg)
        for c in oe.bound_box:
            p = oe.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    if not seen:
        return None, None
    return lo, hi


def setup_world():
    world = bpy.data.worlds.new("hs_world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (*DARK_BG, 1.0)
        bg.inputs[1].default_value = 1.0
    bpy.context.scene.world = world


def add_sun():
    light = bpy.data.lights.new("hs_sun", "SUN")
    light.energy = 3.0
    obj = bpy.data.objects.new("hs_sun", light)
    obj.rotation_euler = (0.65, 0.15, 0.75)
    bpy.context.scene.collection.objects.link(obj)


def configure_workbench(scene):
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.render_aa = "5"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "SINGLE"
    shading.single_color = STONE
    shading.background_type = "WORLD"
    shading.show_cavity = True
    shading.cavity_type = "BOTH"
    shading.show_shadows = True
    shading.shadow_intensity = 0.55
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100


def configure_cycles(scene):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = False
    scene.cycles.seed = 0
    scene.render.resolution_x = 320
    scene.render.resolution_y = 320
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    add_sun()


def render_asset(glb_path, name, engine_mode):
    reset_scene()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    bpy.context.view_layer.update()
    objs = [o for o in bpy.data.objects if o not in before]
    lo, hi = world_bbox(objs)
    if lo is None:
        raise RuntimeError("no mesh geometry after import")
    center = (lo + hi) / 2.0
    radius = max((hi - lo).length / 2.0, 1e-3)

    scene = bpy.context.scene
    setup_world()

    cam_data = bpy.data.cameras.new("hs_cam")
    cam_data.lens = 50.0
    cam_data.clip_end = max(100.0, radius * 20.0)
    cam = bpy.data.objects.new("hs_cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = center + CAM_DIR * (radius * 2.7)
    # track quaternion needs the direction FROM camera TO target (not outward!)
    look = (center - cam.location).normalized()
    cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    out_path = os.path.join(OUT_DIR, f"{name}.png")
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = out_path
    scene.render.film_transparent = False

    attempts = []
    if engine_mode in ("auto", "workbench"):
        attempts.append("workbench")
    if engine_mode in ("auto", "cycles"):
        attempts.append("cycles")

    last_err = None
    for eng in attempts:
        try:
            if eng == "workbench":
                configure_workbench(scene)
            else:
                configure_cycles(scene)
            bpy.ops.render.render(write_still=True)
            return eng, out_path
        except Exception as e:  # noqa: BLE001 — engine failed, try the next one
            last_err = e
            print(f"RENDER_FAIL {name} engine={eng}: {e}")
    raise RuntimeError(f"all engines failed for {name}: {last_err}")


ok = 0
engine_used = {}
for f in files:
    name = f[:-4]
    try:
        eng, path = render_asset(os.path.join(MESH_DIR, f), name, ENGINE_MODE)
        engine_used[eng] = engine_used.get(eng, 0) + 1
        print(f"RENDER_OK {name} {eng} {path} bytes={os.path.getsize(path)}")
        ok += 1
    except Exception as e:  # noqa: BLE001 — keep rendering the rest
        print(f"RENDER_ERROR {name}: {e}")

print(f"PREVIEWS_DONE ok={ok} total={len(files)} engines={engine_used} out={OUT_DIR}")
