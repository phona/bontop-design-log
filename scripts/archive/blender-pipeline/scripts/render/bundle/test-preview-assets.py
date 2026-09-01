from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DECLARATION = ROOT / "data" / "render-bundle-assets.json"


def test_preview_asset_declaration_is_valid_and_complete() -> None:
    with DECLARATION.open(encoding="utf-8") as stream:
        declaration = json.load(stream)

    assert isinstance(declaration, dict)
    assert declaration.get("schema") == "bontop.render-bundle-assets"
    assert declaration.get("version") == 1

    rooms = declaration.get("rooms")
    assert isinstance(rooms, dict)
    assert all(isinstance(room, str) for room in rooms)
    assert all(
        isinstance(asset_directories, list)
        and all(isinstance(asset_directory, str) for asset_directory in asset_directories)
        for asset_directories in rooms.values()
    )

    for asset_directories in rooms.values():
        for asset_directory in asset_directories:
            path = ROOT / asset_directory
            assert path.is_dir(), f"missing preview asset directory: {asset_directory}"
            assert any(path.iterdir()), f"empty preview asset directory: {asset_directory}"


if __name__ == "__main__":
    test_preview_asset_declaration_is_valid_and_complete()
    print("preview asset declaration and directories: ok")
