from pathlib import Path

import pytest

from blenderkit_packed_pbr import export_packed_pbr_images, validate_packed_export_request


def _blend(path: Path) -> Path:
    path.write_bytes(b"packed blend placeholder")
    return path


def test_validate_builds_external_pbr_manifest_without_writing(tmp_path):
    blend = _blend(tmp_path / "candidate.blend")
    spec = validate_packed_export_request(
        blend,
        tmp_path / "assets" / "textures" / "painted_plaster_wall",
        {"normal": "Wall Normal", "roughness": "Wall Roughness"},
        project_root=tmp_path,
        approved_source=True,
    )
    assert spec["errors"] == []
    assert spec["manifest"] == {
        "normal": str(tmp_path / "assets" / "textures" / "painted_plaster_wall" / "normal.jpg"),
        "roughness": str(tmp_path / "assets" / "textures" / "painted_plaster_wall" / "rough.jpg"),
    }
    assert not (tmp_path / "assets").exists()


def test_validate_requires_explicit_approval_for_production_export(tmp_path):
    spec = validate_packed_export_request(
        _blend(tmp_path / "candidate.blend"), tmp_path / "out",
        {"normal": "Normal", "roughness": "Rough"}, project_root=tmp_path
    )
    assert any("approved_source=True" in e for e in spec["errors"])


def test_validate_requires_project_root(tmp_path):
    spec = validate_packed_export_request(
        _blend(tmp_path / "candidate.blend"), tmp_path / "out",
        {"normal": "Normal", "roughness": "Rough"}, approved_source=True,
    )
    assert any("project_root is required" in e for e in spec["errors"])


def test_validate_rejects_blend_outside_project_root(tmp_path):
    blend = _blend(tmp_path.parent / "candidate.blend")
    spec = validate_packed_export_request(
        blend, tmp_path / "out", {"normal": "Normal", "roughness": "Rough"},
        project_root=tmp_path, approved_source=True,
    )
    assert any("blend_path must remain under project_root" in e for e in spec["errors"])


def test_validate_requires_non_color_maps(tmp_path):
    spec = validate_packed_export_request(
        _blend(tmp_path / "candidate.blend"), tmp_path / "out", {},
        project_root=tmp_path, approved_source=True,
    )
    assert any("missing image mapping for required channel: normal" in e for e in spec["errors"])
    assert any("missing image mapping for required channel: roughness" in e for e in spec["errors"])


def test_validate_rejects_escape_and_unknown_channels(tmp_path):
    spec = validate_packed_export_request(
        _blend(tmp_path / "candidate.blend"),
        tmp_path / "../outside",
        {"normal": "../secret", "roughness": "Rough", "displacement": "Height"},
        project_root=tmp_path,
    )
    assert any("target_dir must remain under project_root" in e for e in spec["errors"])
    assert any("path separators" in e for e in spec["errors"])
    assert any("unsupported PBR channel: displacement" in e for e in spec["errors"])


def test_validate_warns_but_does_not_replace_existing_output(tmp_path):
    blend = _blend(tmp_path / "candidate.blend")
    target = tmp_path / "out"
    target.mkdir()
    existing = target / "normal.jpg"
    existing.write_bytes(b"approved")
    spec = validate_packed_export_request(
        blend, target, {"normal": "Normal", "roughness": "Rough"},
        project_root=tmp_path, approved_source=True,
    )
    assert any("destination exists" in warning for warning in spec["warnings"])


def test_export_uses_only_explicit_images_and_preserves_existing(tmp_path):
    blend = _blend(tmp_path / "candidate.blend")
    target = tmp_path / "out"
    target.mkdir()
    (target / "normal.jpg").write_bytes(b"approved")

    class Image:
        def __init__(self, name):
            self.name = name

        def save(self, filepath):
            Path(filepath).write_bytes(self.name.encode())

    class Libraries:
        def load(self, path, link=False):
            class Context:
                def __enter__(self):
                    self.data_from = type("From", (), {"images": ["Normal", "Rough", "Unused"]})()
                    self.data_to = type("To", (), {"images": []})()
                    return self.data_from, self.data_to

                def __exit__(self, *args):
                    self.data_to.images = [Image("Normal"), Image("Rough"), Image("Unused")]

            return Context()

    result = export_packed_pbr_images(
        blend, target, {"normal": "Normal", "roughness": "Rough"},
        project_root=tmp_path, approved_source=True,
        bpy_module=type("Bpy", (), {"data": type("Data", (), {"libraries": Libraries()})()})(),
    )
    assert result["exported"] == {"roughness": str(target / "rough.jpg")}
    assert (target / "normal.jpg").read_bytes() == b"approved"
    assert (target / "rough.jpg").read_bytes() == b"Rough"
    assert not (target / "Unused.jpg").exists()


def test_export_rejects_missing_packed_image(tmp_path):
    blend = _blend(tmp_path / "candidate.blend")

    class Libraries:
        def load(self, path, link=False):
            class Context:
                def __enter__(self):
                    self.data_from = type("From", (), {"images": ["Normal"]})()
                    self.data_to = type("To", (), {"images": []})()
                    return self.data_from, self.data_to

                def __exit__(self, *args):
                    self.data_to.images = [type("Image", (), {"name": "Normal"})()]

            return Context()

    bpy = type("Bpy", (), {"data": type("Data", (), {"libraries": Libraries()})()})()
    with pytest.raises(ValueError, match="missing packed image for roughness"):
        export_packed_pbr_images(
            blend, tmp_path / "out", {"normal": "Normal", "roughness": "Rough"},
            project_root=tmp_path, approved_source=True, bpy_module=bpy,
        )
