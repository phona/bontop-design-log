"""把 render-config.json 的 scenarios×cameras 展开为渲染任务列表（纯逻辑，可单测）。"""


def make_jobs(cfg: dict, version: str) -> list[dict]:
    """scenarios × cameras 全排列 → 渲染任务。

    每个任务含 sun_direction（向量）、lights_on、输出文件名。
    """
    jobs = []
    for cam in cfg.get('cameras', []):
        for sc in cfg.get('scenarios', []):
            jobs.append({
                'camera_id': cam['id'],
                'scenario_id': sc['id'],
                'sun_direction': sc.get('sun_direction', cfg.get('sun', [0, 0, 1])),
                'lights_on': sc.get('lights_on', True),
                'out_name': f"{version}__{cam['id']}__{sc['id']}",
            })
    return jobs
