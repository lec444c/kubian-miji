"""Extract only the supplied, licensed runtime assets; never fetch or bypass a service."""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
BASE_ZIP = Path(r"D:/智器云杯/Universal Base Characters[Standard].zip")
ANIMATION_ZIP = Path(r"D:/智器云杯/Universal Animation Library[Standard].zip")
REFERENCE_ZIP = Path(r"D:/智器云杯/billiards-master.zip")
HAIRDRYER_ZIP = Path(r"C:/Users/yuhongyi/Desktop/BLEND.zip")


def target(relative: str) -> Path:
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def extract(archive: ZipFile, member: str, output: str) -> None:
    with archive.open(member) as source, target(output).open("wb") as destination:
        shutil.copyfileobj(source, destination)


def main() -> None:
    base_source = target("assets/source/quaternius-base/Universal Base Characters[Standard].zip")
    shutil.copy2(BASE_ZIP, base_source)
    animation_source = target("assets/source/quaternius-animations/Universal Animation Library[Standard].zip")
    shutil.copy2(ANIMATION_ZIP, animation_source)
    reference_source = target("assets/source/billiards/billiards-master.zip")
    shutil.copy2(REFERENCE_ZIP, reference_source)
    hairdryer_source = target("assets/source/hairdryer/BLEND.zip")
    shutil.copy2(HAIRDRYER_ZIP, hairdryer_source)

    with ZipFile(BASE_ZIP) as archive:
        prefix = "Universal Base Characters[Standard]/"
        extract(archive, prefix + "License_Standard.txt", "assets/source/quaternius-base/License_Standard.txt")
        model_prefix = prefix + "Base Characters/Godot - UE/"
        for seat, model in (("male", "Superhero_Male_FullBody"), ("female", "Superhero_Female_FullBody")):
            gltf = json.loads(archive.read(model_prefix + model + ".gltf"))
            required = {model + ".bin"}
            for image in gltf.get("images", []):
                uri = image.get("uri", "")
                # The Godot export contains two stale "*_png.png" aliases.
                # Point those entries at the actual PNG members in the supplied ZIP.
                if uri and not (model_prefix + uri) in archive.namelist() and uri.endswith("_png.png"):
                    uri = uri[:-8] + ".png"
                    image["uri"] = uri
                if uri:
                    required.add(uri)
            for filename in sorted(required):
                extract(archive, model_prefix + filename, f"public/assets/characters/{filename}")
            output = target(f"public/assets/characters/{seat}.gltf")
            output.write_text(json.dumps(gltf, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    with ZipFile(ANIMATION_ZIP) as archive:
        prefix = "Universal Animation Library[Standard]/"
        extract(archive, prefix + "License.txt", "assets/source/quaternius-animations/License.txt")
        extract(
            archive,
            prefix + "Unreal-Godot/UAL1_Standard.glb",
            "public/assets/animations/universal-animation-library-standard.glb",
        )

    with ZipFile(REFERENCE_ZIP) as archive:
        for filename in ("p8.gltf", "p8.bin"):
            extract(archive, "billiards-master/dist/models/" + filename, "public/assets/models/" + filename)

    with ZipFile(HAIRDRYER_ZIP) as archive:
        extract(archive, "BLEND/Low_Poly/HairDryer_Low_Poly.blend", "assets/source/hairdryer/HairDryer_Low_Poly.blend")
        extract(archive, "BLEND/readme.rtf", "assets/source/hairdryer/readme.rtf")

    print("Supplied character, animation, reference-table, and hairdryer sources extracted.")


if __name__ == "__main__":
    main()
