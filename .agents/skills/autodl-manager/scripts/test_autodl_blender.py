import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import autodl_blender


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def make_bundle(tmp_path):
    bundle = tmp_path / "custom-bundle"
    bundle.mkdir()
    files = {"house.glb": b"glb", "render-config.json": b"{}", "project-render-facts.json": b"{}"}
    artifacts = {}
    for name, content in files.items():
        path = bundle / name
        path.write_bytes(content)
        key = {"house.glb": "glb", "render-config.json": "renderConfig", "project-render-facts.json": "projectRenderFacts"}[name]
        artifacts[key] = {"path": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
    source = {}
    resources = []
    source_sha = digest([])
    resources_sha = digest([])
    artifact_rows = [[key, artifacts[key]["path"], artifacts[key]["bytes"], artifacts[key]["sha256"]] for key in sorted(artifacts)]
    artifacts_sha = digest(artifact_rows)
    bundle_sha = digest({"sourceInputsSha256": source_sha, "resourcesSha256": resources_sha, "artifactsSha256": artifacts_sha})
    manifest = {
        "schemaVersion": "2.0",
        "sourceInputs": source,
        "resources": resources,
        "artifacts": artifacts,
        "inputFingerprints": {
            "sourceInputsSha256": source_sha,
            "resourcesSha256": resources_sha,
            "artifactsSha256": artifacts_sha,
            "bundleSha256": bundle_sha,
        },
    }
    (bundle / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return bundle


def test_render_command_uses_custom_bundle_manifest_and_script():
    values = {"bundle": "tmp/custom-bundle", "remote_root": "/root/work", "blender_bin": "/root/blender/blender"}
    command = autodl_blender.render_command(values, bundle="tmp/alternate-bundle", out_dir="tmp/cycles", version="v42")
    assert "tmp/alternate-bundle/house.glb" in command
    assert "tmp/alternate-bundle/render-config.json" in command
    assert "tmp/alternate-bundle/manifest.json" in command
    assert "tmp/alternate-bundle/scripts/blender/dress_scene.py" in command
    assert "--manifest" in command
    assert "--config-dir tmp/alternate-bundle" in command
    assert "--config-dir tmp/alternate-bundle/config" not in command
    assert "tmp/final-render-bundle" not in command


def test_preflight_accepts_self_consistent_bundle(tmp_path):
    bundle = make_bundle(Path(autodl_blender.PROJECT_ROOT) / "tmp")
    try:
        result = autodl_blender.do_preflight(bundle.relative_to(autodl_blender.PROJECT_ROOT))
        assert result["ok"] is True
    finally:
        for path in sorted(bundle.rglob("*"), reverse=True):
            if path.is_file():
                path.unlink()
            else:
                path.rmdir()
        bundle.rmdir()


def test_preflight_rejects_manifest_hash_mismatch(tmp_path):
    bundle = make_bundle(Path(autodl_blender.PROJECT_ROOT) / "tmp")
    try:
        (bundle / "house.glb").write_bytes(b"changed")
        with pytest.raises(autodl_blender.WorkflowError, match="hash/size"):
            autodl_blender.do_preflight(bundle.relative_to(autodl_blender.PROJECT_ROOT))
    finally:
        for path in sorted(bundle.rglob("*"), reverse=True):
            if path.is_file():
                path.unlink()
            else:
                path.rmdir()
        bundle.rmdir()


def test_preflight_requires_input_fingerprints(tmp_path):
    bundle = make_bundle(Path(autodl_blender.PROJECT_ROOT) / "tmp")
    try:
        manifest_path = bundle / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        del manifest["inputFingerprints"]
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with pytest.raises(autodl_blender.WorkflowError, match="inputFingerprints"):
            autodl_blender.do_preflight(bundle.relative_to(autodl_blender.PROJECT_ROOT))
    finally:
        for path in sorted(bundle.rglob("*"), reverse=True):
            if path.is_file():
                path.unlink()
            else:
                path.rmdir()
        bundle.rmdir()


def test_module_import_does_not_require_project_node_tools():
    assert "node_modules" not in autodl_blender.__file__
