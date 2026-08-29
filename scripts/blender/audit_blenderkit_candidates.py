"""Batch audit local BlenderKit .blend candidates inside Blender."""
from __future__ import annotations
import argparse, json, os
from pathlib import Path

def audit_one(bpy, path: Path) -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        with bpy.data.libraries.load(str(path), link=False) as (data_from, data_to):
            data_to.objects = list(data_from.objects)
        for obj in data_to.objects:
            if obj is not None:
                try:
                    bpy.context.collection.objects.link(obj)
                except Exception:
                    pass
        meshes = [o for o in bpy.data.objects if o.type == 'MESH']
        materials = []
        images = []
        for obj in meshes:
            materials.extend(m for m in obj.data.materials if m is not None)
        unique_materials = {id(m): m for m in materials}
        for mat in unique_materials.values():
            if not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image is not None:
                    images.append(node.image)
        dims = []
        for obj in meshes:
            try:
                dims.append([round(float(v), 4) for v in obj.dimensions])
            except Exception:
                pass
        return {
            'file': str(path),
            'file_size': path.stat().st_size,
            'status': 'ok',
            'mesh_count': len(meshes),
            'object_names': [o.name for o in meshes],
            'dimensions': dims,
            'material_count': len(unique_materials),
            'material_names': [m.name for m in unique_materials.values()],
            'image_texture_count': len(images),
            'unique_image_count': len({id(i) for i in images}),
            'packed_image_count': sum(1 for i in {id(i): i for i in images}.values() if i.packed_file is not None),
            'uv_layer_count': sum(len(o.data.uv_layers) for o in meshes),
        }
    except Exception as exc:
        return {'file': str(path), 'file_size': path.stat().st_size, 'status': 'error', 'error': repr(exc)}

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--out', required=True)
    import sys
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    import bpy
    root = Path(args.root)
    files = sorted(root.rglob('*.blend'))
    report = {'schema': 'bontop.blenderkit-candidate-audit', 'version': 1, 'root': str(root), 'candidates': [audit_one(bpy, p) for p in files]}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'files': len(files), 'ok': sum(x['status']=='ok' for x in report['candidates']), 'errors': sum(x['status']!='ok' for x in report['candidates']), 'out': args.out}))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
