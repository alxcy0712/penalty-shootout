"""Read-only API check for the disabled legacy authoring profile.

This probe opens no .blend, saves no files and runs no authoring operation.
Run: blender -b --factory-startup --disable-autoexec --python THIS_FILE
"""
import importlib.util
import json
import sys


def inspect_capabilities(bpy):
    try:
        properties = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    except (AttributeError, RuntimeError):
        properties = []
    try:
        meshopt_module = importlib.util.find_spec('io_scene_gltf2.io.exp.meshopt') is not None
    except (ModuleNotFoundError, ValueError):
        meshopt_module = False
    return {
        'actionLayers': hasattr(bpy.types.Action, 'layers'),
        'actionSlots': hasattr(bpy.types.Action, 'slots'),
        'meshoptExportProperty': 'export_meshopt_compression_enable' in properties,
        'animationModeExportProperty': 'export_animation_mode' in properties,
        'meshoptModule': meshopt_module,
    }


def require_capabilities(capabilities):
    missing = [name for name, present in capabilities.items() if present is not True]
    if missing:
        raise RuntimeError('Unsupported Blender/exporter APIs before authoring: ' + ', '.join(missing))


if __name__ == '__main__':
    import bpy
    capabilities = inspect_capabilities(bpy)
    print(json.dumps({'blender': bpy.app.version_string, 'capabilities': capabilities,
                      'sourceWrites': False, 'generatingAdapterEnabled': False}))
    try:
        require_capabilities(capabilities)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        # Blender otherwise sometimes exits zero after Python exceptions.
        sys.exit(1)
