"""Tier-2 asset: beveled obelisk via Blender headless (bpy).

SUPERSEDED (pipeline v2): scripts/blender/asset_library.py builds this same
obelisk (identical quality bar) plus the rest of the tier-2 library and
batch-exports every collection in one pass — see `make assets-library`.
This file is kept runnable for one-off obelisk exports.

Run: blender -b -P scripts/blender/obelisk.py -- public/assets/meshes
"""
import bpy, sys, math

out_dir = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "public/assets/meshes"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.42, radius2=0.10, depth=1.6)
obj = bpy.context.active_object
obj.name = "obelisk"
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.object.mode_set(mode="OBJECT")
bev = obj.modifiers.new("bevel", "BEVEL")
bev.width = 0.045
bev.segments = 2
bpy.ops.object.modifier_apply(modifier="bevel")
for p in obj.data.polygons:
    p.use_smooth = False

bpy.ops.export_scene.gltf(filepath=f"{out_dir}/obelisk.glb", export_format="GLB", export_apply=True)
print("BLENDER_ASSET_OK obelisk.glb", len(obj.data.vertices), "verts")
