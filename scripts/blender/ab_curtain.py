import bpy,json,os,sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import dress_scene
bpy.ops.wm.read_factory_settings(use_empty=True)
glb,cfgp,root=sys.argv[sys.argv.index('--')+1:sys.argv.index('--')+4]; cfg=json.load(open(cfgp)); from dress_config import make_jobs
jobs=[j for j in make_jobs(cfg,version='v1') if j['camera_id']=='bedroom_se_overview']; args={'glb':glb,'config':cfgp,'engine':'EEVEE','config-dir':root}; rt=dress_scene.initialize_scene(args,cfg,jobs); cam=next(c for c in cfg['cameras'] if c['id']=='bedroom_se_overview'); dress_scene._apply_job_state(rt,cam,jobs[0]['scenario'])
for victim in [None,'south_east_curtain','sky_plane:south_east_curtain','south_east_curtain_and_sky']:
 for o in bpy.data.objects:
  if o.name in ('south_east_curtain','sky_plane:south_east_curtain'): o.hide_render = victim in ('south_east_curtain','south_east_curtain_and_sky') if o.name=='south_east_curtain' else victim=='south_east_curtain_and_sky'
 out=os.path.join(root,'tmp','ab-curtain-'+str(victim)+'.png'); s=bpy.context.scene;s.render.resolution_x=960;s.render.resolution_y=540;s.render.resolution_percentage=100;s.render.filepath=out;bpy.ops.render.render(write_still=True);print('OUT',victim,out)
