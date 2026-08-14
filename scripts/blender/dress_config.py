"""把 render-config.json 的 scenarios×cameras 展开为渲染任务列表（纯逻辑，可单测）。"""


def make_jobs(cfg: dict, version: str) -> list[dict]:
    """scenarios × cameras 全排列 → 渲染任务。

    每个任务直接持有完整 scenario dict（sun_direction/world_color/world_strength/lights_on），
    由 render_scene 消费。
    """
    jobs = []
    for cam in cfg.get('cameras', []):
        for sc in cfg.get('scenarios', []):
            jobs.append({
                'camera_id': cam['id'],
                'scenario_id': sc['id'],
                'scenario': sc,
                'out_name': f"{version}__{cam['id']}__{sc['id']}",
            })
    return jobs
