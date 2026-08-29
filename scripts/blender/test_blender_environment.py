import sys
import types

sys.path.insert(0, __import__('os').path.dirname(__file__))

import blender_environment


class Vector:
    def __init__(self, values):
        self.x, self.y, self.z = values

    def __add__(self, other):
        return Vector((self.x + other.x, self.y + other.y, self.z + other.z))

    def __sub__(self, other):
        return Vector((self.x - other.x, self.y - other.y, self.z - other.z))

    def __truediv__(self, value):
        return Vector((self.x / value, self.y / value, self.z / value))

    def __iter__(self):
        return iter((self.x, self.y, self.z))

    def __getitem__(self, index):
        return (self.x, self.y, self.z)[index]


class Identity:
    def __matmul__(self, value):
        return value


class Socket:
    def __init__(self):
        self.default_value = None


class Node:
    def __init__(self, bl_idname):
        self.bl_idname = bl_idname
        self.inputs = {'Emission Color': Socket(), 'Emission Strength': Socket(), 'Surface': Socket()}
        self.outputs = {'BSDF': Socket()}


class NodeList(list):
    def new(self, node_type):
        node = Node(node_type)
        self.append(node)
        return node


class NodeTree:
    def __init__(self):
        self.nodes = NodeList()
        self.links = types.SimpleNamespace(new=lambda *args: None)


class Material:
    def __init__(self, name):
        self.name = name
        self.use_nodes = False
        self.node_tree = NodeTree()


class MaterialList(list):
    def new(self, name):
        material = Material(name)
        self.append(material)
        return material


class Object:
    def __init__(self, name, *, glass=False):
        self.name = name
        self.type = 'MESH'
        self.matrix_world = Identity()
        self.bound_box = ((0, 0, 0), (2, 0.1, 3)) if glass else ((0, 0, 0),)
        self.hide_render = False
        self.location = None
        self.rotation_euler = None
        self.scale = None
        self.data = types.SimpleNamespace(materials=[])


class CollectionObjects(list):
    def link(self, obj):
        if obj not in self:
            self.append(obj)


class FakeBpy:
    def __init__(self):
        self.data = types.SimpleNamespace(objects=[], materials=MaterialList())
        collection_objects = CollectionObjects()
        self.context = types.SimpleNamespace(
            object=None,
            scene=types.SimpleNamespace(collection=types.SimpleNamespace(objects=collection_objects)),
        )
        self.ops = types.SimpleNamespace(mesh=types.SimpleNamespace(primitive_plane_add=self.add_plane))

    def add_plane(self, *, size, location):
        plane = Object('Plane')
        plane.location = location
        self.data.objects.append(plane)
        self.context.object = plane
        self.context.scene.collection.objects.link(plane)


def _find_node(tree, node_type):
    return next((node for node in tree.nodes if node.bl_idname == node_type), None)


def _linear(rgb):
    return rgb


def test_sky_planes_are_idempotent_and_follow_hdri_visibility(monkeypatch):
    bpy = FakeBpy()
    glass = Object('living_south_curtain', glass=True)
    bpy.data.objects.append(glass)
    monkeypatch.setitem(sys.modules, 'mathutils', types.SimpleNamespace(Vector=Vector))

    blender_environment.add_sky_planes(
        {'loaded': False}, bpy_module=bpy, glass_ids={glass.name},
        find_node_fn=_find_node, srgb_to_linear_tuple_fn=_linear,
    )
    planes = [obj for obj in bpy.data.objects if obj.name.startswith('sky_plane:')]
    assert len(planes) == 1
    first_plane = planes[0]
    assert first_plane.hide_render is False
    assert len(bpy.data.materials) == 1

    blender_environment.add_sky_planes(
        {'loaded': False}, bpy_module=bpy, glass_ids={glass.name},
        find_node_fn=_find_node, srgb_to_linear_tuple_fn=_linear,
    )
    assert [obj for obj in bpy.data.objects if obj.name.startswith('sky_plane:')] == [first_plane]
    assert len(bpy.data.materials) == 1

    blender_environment.add_sky_planes(
        {'loaded': True}, bpy_module=bpy, glass_ids={glass.name},
        find_node_fn=_find_node, srgb_to_linear_tuple_fn=_linear,
    )
    assert first_plane.hide_render is True

    blender_environment.add_sky_planes(
        {'loaded': False}, bpy_module=bpy, glass_ids={glass.name},
        find_node_fn=_find_node, srgb_to_linear_tuple_fn=_linear,
    )
    assert first_plane.hide_render is False
    assert len([obj for obj in bpy.data.objects if obj.name.startswith('sky_plane:')]) == 1


if __name__ == '__main__':
    print('Run with pytest')
