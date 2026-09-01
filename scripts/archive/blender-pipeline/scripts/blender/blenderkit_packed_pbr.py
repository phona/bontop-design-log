"""离线导出 BlenderKit packed PBR 资源，不联网、不读取或保存 API key。

该模块把已完成云端筛选的本地 ``.blend`` 当作输入，仅导出显式指定的
Image datablock 到 ``assets/textures/<texture_id>/``。校验函数不依赖 bpy，
可在普通 Python/pytest 中运行；Blender 入口只负责读取 packed images 和
保存文件，不追加材质、不修改场景。

典型流程（云端命令由调用者在 shell 中执行，KEY 不入库）：

    KEY=... curl -H "Authorization: Token $KEY" \\
      "https://www.blenderkit.com/api/v1/assets/<uuid>/"
    # 按返回的 file id 获取临时 URL，并下载到本地；随后在 Blender Python 中：
    export_packed_pbr_images(
        "approved-source.blend", "assets/textures/painted_plaster_wall",
        {"normal": "Normal", "roughness": "Roughness"},
        project_root="/path/to/project", approved_source=True,
    )
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Mapping, Sequence


ALLOWED_CHANNELS = frozenset(("base_color", "normal", "roughness", "ao", "bump"))
DEFAULT_FILENAMES = {
    "base_color": "diff.jpg",
    "normal": "normal.jpg",
    "roughness": "rough.jpg",
    "ao": "ao.jpg",
    "bump": "bump.jpg",
}
_SAFE_NAME = re.compile(r"^[^/\\]+$")


def validate_packed_export_request(
    blend_path: str | os.PathLike[str],
    target_dir: str | os.PathLike[str],
    channel_map: Mapping[str, str],
    *,
    required_channels: Sequence[str] = ("normal", "roughness"),
    project_root: str | os.PathLike[str] | None = None,
    approved_source: bool = False,
) -> dict[str, Any]:
    """Validate an offline export request and return a deterministic manifest.

    ``channel_map`` maps an output PBR channel to an Image datablock name in the
    packed blend. No filesystem is changed. ``project_root`` is required so both
    the input blend and target directory stay inside the project. Existing output
    files are reported as warnings and are never overwritten by the exporter.
    ``approved_source`` is an explicit production gate; temporary candidates are
    rejected unless the caller marks the source as approved.
    """
    errors: list[str] = []
    warnings: list[str] = []
    if project_root is None:
        errors.append("project_root is required for path-safe export")
    blend = Path(blend_path).expanduser()
    target = Path(target_dir).expanduser()
    root = Path(project_root).expanduser().resolve() if project_root else None
    if not blend.is_absolute() and root:
        blend = root / blend
    if not target.is_absolute() and root:
        target = root / target
    blend = blend.resolve()
    target = target.resolve()

    if not blend.is_file():
        errors.append(f"packed blend does not exist: {blend}")
    if root:
        try:
            blend.relative_to(root)
        except ValueError:
            errors.append("blend_path must remain under project_root")
        try:
            target.relative_to(root)
        except ValueError:
            errors.append("target_dir must remain under project_root")
    if not approved_source:
        errors.append("approved_source=True is required; temporary candidates are not production inputs")
    if not isinstance(channel_map, Mapping):
        errors.append("channel_map must be an object")
        channel_map = {}
    if not isinstance(required_channels, Sequence) or isinstance(required_channels, (str, bytes)):
        errors.append("required_channels must be a sequence")
        required_channels = ("normal", "roughness")

    required = tuple(required_channels)
    for channel in required:
        if channel not in ALLOWED_CHANNELS:
            errors.append(f"unsupported required channel: {channel}")
    for channel, image_name in channel_map.items():
        if channel not in ALLOWED_CHANNELS:
            errors.append(f"unsupported PBR channel: {channel}")
        if not isinstance(image_name, str) or not image_name.strip():
            errors.append(f"image name for {channel} must be a non-empty string")
        elif not _SAFE_NAME.match(image_name) or image_name in {".", ".."}:
            errors.append(f"image name for {channel} must not contain path separators")
    for channel in required:
        if channel not in channel_map:
            errors.append(f"missing image mapping for required channel: {channel}")
    if len(set(channel_map.values())) != len(channel_map):
        errors.append("each PBR channel must map to a distinct image name")

    manifest: dict[str, str] = {}
    for channel in sorted(channel_map):
        if channel in ALLOWED_CHANNELS and isinstance(channel_map[channel], str):
            destination = target / DEFAULT_FILENAMES[channel]
            manifest[channel] = str(destination)
            if destination.exists():
                warnings.append(f"destination exists; exporter will not overwrite: {destination}")

    return {
        "blend_path": str(blend),
        "target_dir": str(target),
        "manifest": manifest,
        "warnings": warnings,
        "errors": errors,
    }


def export_packed_pbr_images(
    blend_path: str | os.PathLike[str],
    target_dir: str | os.PathLike[str],
    channel_map: Mapping[str, str],
    *,
    required_channels: Sequence[str] = ("normal", "roughness"),
    project_root: str | os.PathLike[str] | None = None,
    approved_source: bool = False,
    bpy_module: Any | None = None,
) -> dict[str, Any]:
    """Export explicitly mapped packed images using a supplied Blender module.

    This function must run inside Blender (or receive a compatible test double).
    It never downloads, appends materials, changes the active scene, or
    overwrites an existing destination. ``bpy_module`` is injectable solely for
    tests and embedding.
    """
    spec = validate_packed_export_request(
        blend_path, target_dir, channel_map,
        required_channels=required_channels, project_root=project_root,
        approved_source=approved_source,
    )
    if spec["errors"]:
        raise ValueError("; ".join(spec["errors"]))
    bpy = bpy_module
    if bpy is None:
        import bpy as bpy  # type: ignore[no-redef,import-not-found]

    target = Path(spec["target_dir"])
    target.mkdir(parents=True, exist_ok=True)
    exported: dict[str, str] = {}
    missing: list[str] = []
    with bpy.data.libraries.load(spec["blend_path"], link=False) as (data_from, data_to):
        data_to.images = list(data_from.images)
    images = {image.name: image for image in data_to.images if image is not None}
    for channel in sorted(channel_map):
        image_name = channel_map[channel]
        if image_name not in images:
            missing.append(f"missing packed image for {channel}: {image_name}")
    if missing:
        raise ValueError("; ".join(missing))
    for channel in sorted(channel_map):
        image = images[channel_map[channel]]
        destination = Path(spec["manifest"][channel])
        if destination.exists():
            continue
        image.save(filepath=str(destination))
        exported[channel] = str(destination)
    return {**spec, "exported": exported}


if __name__ == "__main__":
    raise SystemExit("Run export_packed_pbr_images from Blender; this tool never downloads assets.")
