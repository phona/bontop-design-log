import bpy, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dress_scene
bpy.ops.wm.read_factory_settings(use_empty=True)
args={'glb':sys.argv[sys.argv.index('--')+1], 'config':sys.argv[sys.argv.index('--')+2], 'engine':'EEVEE','config-dir':sys.argv[sys.argv.index('--')+3]}
with open(args['config'],encoding='utf8') as f: cfg=json.load(f)
from dress_config import make_jobs
jobs=[j for j in make_jobs(cfg,version='v1') if j['camera_id']=='bedroom_se_overview']
rt=dress_scene.initialize_scene(args,cfg,jobs)
cam=next(c for c in cfg['cameras'] if c['id']=='bedroom_se_overview')
for j in jobs:
 s=dress_scene._apply_job_state(rt,cam,j['scenario'])
 print('STATE',j['scenario']['id'],s)
 for name in ('south_east_curtain','curtain_study_south','west_curtain'):
  o=bpy.data.objects.get(name)
  if o:
   mats=[]
   if o.type=='MESH':
    for m in o.data.materials:
     bs=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None) if m and m.use_nodes else None
     mats.append((m.name, tuple(round(x,3) for x in bs.inputs['Base Color'].default_value[:3]) if bs and not bs.inputs['Base Color'].is_linked else 'linked'))
   print('CURTAIN',name,'type',o.type,'hide',o.hide_render,'classify',dress_scene.classify(o),'mats',mats)
 print('---')
