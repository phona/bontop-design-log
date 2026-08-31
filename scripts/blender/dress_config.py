"""把 render-config.json 的 scenarios×cameras 展开为渲染任务列表（纯逻辑，可单测）。"""


def make_jobs(cfg: dict, version: str, scenario_id: str | None = None) -> list[dict]:
    """cameras × scenarios → 渲染任务。

    每个任务直接持有完整 scenario dict（sun_direction/world_color/world_strength/lights_on），
    由 render_scene 消费。
    camera 可选 `scenarios: [id]` 白名单：只出指定工况（材质评审特写不进氛围批量，反之亦然）。
    ``scenario_id`` 可选时，在创建场景前只保留指定工况。
    """
    jobs = []
    for cam in cfg.get('cameras', []):
        allow = cam.get('scenarios')
        for sc in cfg.get('scenarios', []):
            if scenario_id is not None and sc['id'] != scenario_id:
                continue
            if allow is not None and sc['id'] not in allow:
                continue
            jobs.append({
                'camera_id': cam['id'],
                'scenario_id': sc['id'],
                'scenario': sc,
                'out_name': f"{version}__{cam['id']}__{sc['id']}",
            })
    return jobs
