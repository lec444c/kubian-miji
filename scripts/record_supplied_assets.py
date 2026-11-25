"""Record the actual supplied assets, converted outputs, and deterministic hashes."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "assets" / "asset-manifest.json"
RUNTIME_MANIFEST = ROOT / "public" / "assets" / "asset-manifest.json"
DATE = "2026-11-18"


def paths(*values: str) -> list[str]:
    return list(values)


def character_outputs() -> list[str]:
    return sorted(
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "public" / "assets" / "characters").iterdir()
        if path.is_file()
    )


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest["notes"] = [
        "Runtime assets are local. The supplied hairdryer BLEND was converted to GLB with Blender 4.5.3 LTS; no remote conversion service is used.",
        "The supplied Standard character archive contains Superhero male/female full bodies, not Regular full bodies. The two stale *_png.png glTF aliases were rewritten to the actual supplied PNG member names.",
        "The uncompressed reference p8.gltf is used at runtime because its FullCloth semantic node is required for exact bed alignment; p8.min.gltf is retained as a reference output.",
        "Intermediate duplicate files under assets/source/*/extracted are not separately listed; original ZIPs and deployed outputs are listed and hashed.",
    ]

    assets = manifest["assets"]
    regular = next(asset for asset in assets if asset["id"] == "quaternius-universal-base-characters-regular")
    regular["reason"] += " The later user-supplied Standard archive was inspected and contains Superhero full bodies rather than Regular full bodies; it is recorded separately without renaming the contents."

    animation = next(asset for asset in assets if asset["id"] == "quaternius-universal-animation-library-standard")
    supplied_animation_zip = "assets/source/quaternius-animations/Universal Animation Library[Standard].zip"
    if supplied_animation_zip not in animation["originalPaths"]:
        animation["originalPaths"].append(supplied_animation_zip)
    animation["usage"] += " The deployed GLB is extracted from the user-supplied Standard ZIP."
    animation_glb = (ROOT / "public" / "assets" / "animations" / "universal-animation-library-standard.glb").read_bytes()
    json_length = int.from_bytes(animation_glb[12:16], "little")
    animation_json = json.loads(animation_glb[20:20 + json_length])
    clips = [entry["name"] for entry in animation_json.get("animations", [])]
    animation["clipValidation"]["expectedClipCount"] = len(clips)
    animation["clipValidation"]["availableClips"] = clips
    animation["clipValidation"]["clipCountNote"] = "The user-supplied Standard GLB contains 43 named entries including A_TPose; this differs from the previously downloaded OpenGameArt GLB and is recorded from the deployed file itself."

    superhero = {
        "id": "quaternius-universal-base-characters-standard-superhero",
        "name": "Universal Base Characters Standard - Superhero male/female full bodies",
        "author": "Quaternius",
        "sourceUrl": "https://quaternius.com/packs/universalbasecharacters.html",
        "downloadUrl": None,
        "acquiredDate": DATE,
        "license": "CC0 1.0 Universal, as stated in License_Standard.txt inside the user-supplied ZIP.",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        "usage": "Local animated male and female full-body characters for the two billiards seats.",
        "restrictions": "These are Superhero full bodies, not the originally requested Regular variants. Two nonexistent *_png.png aliases in the Godot glTF exports were corrected to the corresponding supplied PNG filenames; no texture content was generated.",
        "status": "available",
        "licenseEvidence": ["assets/source/quaternius-base/License_Standard.txt"],
        "documentationPaths": [],
        "originalPaths": ["assets/source/quaternius-base/Universal Base Characters[Standard].zip"],
        "outputPaths": character_outputs(),
    }

    reference = {
        "id": "tailuge-billiards-reference-table",
        "name": "tailuge/billiards p8 reference pool table",
        "author": "tailuge/billiards contributors",
        "sourceUrl": "https://github.com/tailuge/billiards",
        "downloadUrl": "https://github.com/tailuge/billiards/commit/92a2818928e9ab8576fd300615509c88b0b0f183",
        "acquiredDate": DATE,
        "license": "GNU General Public License v3.0; the upstream copyright and license are retained in the project LICENSE, NOTICE, licenses, and third_party snapshot.",
        "licenseUrl": "https://github.com/tailuge/billiards/blob/master/LICENSE",
        "usage": "Local reference table mesh. The uncompressed p8.gltf FullCloth node is fitted to the authoritative 2.54 m by 1.27 m physics bed; materials and imported lights are adapted in the view.",
        "restrictions": "GPLv3 applies to copied and adapted table/model and source material. No claim is made that visual table meshes alter the validated physics geometry.",
        "status": "available",
        "licenseEvidence": [],
        "documentationPaths": [],
        "originalPaths": ["assets/source/billiards/billiards-master.zip"],
        "outputPaths": paths(
            "public/assets/models/p8.gltf",
            "public/assets/models/p8.bin",
            "public/assets/models/p8.min.gltf",
            "public/assets/models/p8.min.bin",
        ),
    }

    hairdryer = next(asset for asset in assets if asset["id"] == "cgtrader-vintage-hairdryer")
    hairdryer.update({
        "name": "Vintage hairdryer - user-supplied HairDryer_Low_Poly.blend",
        "author": "Zejak, as signed in the supplied readme.rtf",
        "downloadUrl": None,
        "license": "The supplied readme.rtf permits use of the model in 3D projects and renders and states that crediting is not required. No additional CGTrader page license is asserted.",
        "usage": "Local hairdryer skill prop, converted from the supplied BLEND to an embedded GLB with Blender 4.5.3 LTS and aligned so its barrel follows the target ball.",
        "restrictions": "Personal, non-commercial Demo use at the user's direction. One empty roughness image had no size and was not exported; no replacement texture or successful export of that image is claimed.",
        "status": "available",
        "licenseEvidence": ["assets/source/hairdryer/readme.rtf"],
        "documentationPaths": ["assets/source/hairdryer/conversion-report.json"],
        "originalPaths": paths(
            "assets/source/hairdryer/BLEND.zip",
            "assets/source/hairdryer/HairDryer_Low_Poly.blend",
        ),
        "outputPaths": ["public/assets/models/hairdryer.glb"],
    })
    hairdryer.pop("reason", None)

    for asset in (superhero, reference):
        index = next((i for i, current in enumerate(assets) if current["id"] == asset["id"]), None)
        if index is None:
            assets.append(asset)
        else:
            assets[index] = asset

    required_paths = {
        path
        for asset in assets
        for field in ("licenseEvidence", "documentationPaths", "originalPaths", "outputPaths")
        for path in asset.get(field, [])
    }
    files = {record["path"]: record for record in manifest["files"]}
    for relative in sorted(required_paths):
        absolute = ROOT / relative
        if not absolute.is_file():
            raise FileNotFoundError(relative)
        record = files.setdefault(relative, {
            "path": relative,
            "roles": ["supplied-source" if relative.startswith("assets/source/") else "runtime-asset"],
        })
        data = absolute.read_bytes()
        record["bytes"] = len(data)
        record["sha256"] = hashlib.sha256(data).hexdigest()
        if relative == "public/assets/models/hairdryer.glb":
            record["operation"] = "Converted from the supplied BLEND with Blender 4.5.3 LTS; embedded GLB"
        elif relative.endswith("conversion-report.json"):
            record["operation"] = "Blender conversion report"
        elif relative.endswith("male.gltf") or relative.endswith("female.gltf"):
            record["operation"] = "Extracted glTF with only stale image aliases corrected"
        else:
            record.setdefault("operation", "Copied byte-for-byte from the supplied archive" if relative.startswith("assets/source/") or relative.startswith("public/assets/") else "Existing recorded file")

    manifest["files"] = [files[path] for path in sorted(files)]
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    MANIFEST.write_text(text, encoding="utf-8")
    RUNTIME_MANIFEST.write_text(text, encoding="utf-8")
    print(f"Recorded {len(assets)} assets and {len(files)} files with SHA-256 hashes.")


if __name__ == "__main__":
    main()
