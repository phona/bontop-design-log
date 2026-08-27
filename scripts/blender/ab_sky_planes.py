import bpy, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dress_scene
bpy.ops.wm.read_factory_settings(use_empty=True)
glb,cfgp,root=sys.argv[sys.argv.index('--')+1:sys.argv.index('--')+4]
with open(cfgp,encoding='utf8') as f: cfg=json.load(f)
from dress_config import make_jobs
jobs=[j for j in make_jobs(cfg,version='v1') if j['camera_id']=='bedroom_se_overview']
args={'glb':glb,'config':cfgp,'engine':'EEVEE','config-dir':root}
rt=dress_scene.initialize_scene(args,cfg,jobs)
cam=next(c for c in cfg['cameras'] if c['id']=='bedroom_se_overview')
for o in bpy.data.objects:
 if o.name.startswith('sky_plane:'):
  print('SKY',o.name,'hide',o.hide_render,'loc',tuple(round(x,3) for x in o.location),'scale',tuple(round(x,3) for x in o.scale),'bbox',tuple(round(x,3) for x in (min((o.matrix_world@__import__('mathutils').Vector(c)).x for c in o.bound_box),max((o.matrix_world@__import__('mathutils').Vector(c)).x for c in o.bound_box),min((o.matrix_world@__import__('mathutils').Vector(c)).y for c in o.bound_box),max((o.matrix_world@__import__('mathutils').Vector(c)).y for c in o.bound_box),min((o.matrix_world@__import__('mathutils').Vector(c)).z for c in o.bound_box),max((o.matrix_world@__import__('mathutils').Vector(c)).z for c in o.bound_box))))
for j in jobs:
 dress_scene._apply_job_state(rt,cam,j['scenario'])
 for o in bpy.data.objects:
  if o.name.startswith('sky_plane:'):
   print('STATE',j['scenario']['id'],'SKY',o.name,'hide',o.hide_render)
 out=os.path.join(root,'tmp','ab-'+j['scenario']['id']+'-all.png')
 bpy.context.scene.render.resolution_x=960; bpy.context.scene.render.resolution_y=540; bpy.context.scene.render.resolution_percentage=100; bpy.context.scene.render.filepath=out
 bpy.ops.render.render(write_still=True)
 print('RENDER',out)
 if j['scenario']['id'] == 'material_review':
  for victim in [o for o in bpy.data.objects if o.name.startswith('sky_plane:')]:
   for o in bpy.data.objects:
    if o.name.startswith('sky_plane:'): o.hide_render = (o != victim)
   out=os.path.join(root,'tmp','ab-material-only-'+victim.name.replace(':','_')+'.png')
   bpy.context.scene.render.filepath=out; bpy.ops.render.render(write_still=True)
   print('ONLY',victim.name,out)
  for o in bpy.data.objects:
   if o.name.startswith('sky_plane:'): o.hide_render=True
  out=os.path.join(root,'tmp','ab-material-none.png'); bpy.context.scene.render.filepath=out; bpy.ops.render.render(write_still=True); print('NONE',out)
