"""Convert the user-supplied Blender hairdryer to a local glTF 2.0 GLB."""
from pathlib import Path
import json
import bpy

root = Path(__file__).resolve().parents[1]
output = root / "public" / "assets" / "models" / "hairdryer.glb"
output.parent.mkdir(parents=True, exist_ok=True)

mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if not mesh_objects:
    raise RuntimeError("The supplied Blender file contains no mesh objects")

bpy.ops.export_scene.gltf(
    filepath=str(output),
    export_format="GLB",
    export_apply=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
)

report = {
    "source": str(Path(bpy.data.filepath).relative_to(root)).replace("\\", "/"),
    "output": str(output.relative_to(root)).replace("\\", "/"),
    "blenderVersion": bpy.app.version_string,
    "meshObjects": [
        {
            "name": obj.name,
            "vertices": len(obj.data.vertices),
            "polygons": len(obj.data.polygons),
            "dimensions": list(obj.dimensions),
        }
        for obj in mesh_objects
    ],
    "outputBytes": output.stat().st_size,
}
report_path = root / "assets" / "source" / "hairdryer" / "conversion-report.json"
report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
