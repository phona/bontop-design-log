import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { load } from 'js-yaml';
import hvacRaw from '../../../config/hvac.yaml?raw';
import { hvacPlanOptions } from '@shared/hvac-plans';

/**
 * HVAC 方案面板（2026-10-13 阶段 3：数据源从 shared/houseData.ts 的 invented 报价表
 * 改成 config/hvac.yaml，与 server/project-catalog.ts 读同一个文件、同一个映射函数）。
 *
 * 为什么 app 能直接 import YAML：designData.ts 早就是 `?raw` + js-yaml 的同一个套路
 * （见 app/src/data/designData.ts 顶部）。单价与 status 都在 config/hvac.yaml 的
 * `commercial` 块里，所以这里与预算侧不可能再对不上——原先 A2 在 app 显示 29,000、
 * 在合同是 36,000，正是两份硬编码各写各的后果。
 *
 * 3D 实体仍由 render-facts projection 的专用渲染器管理（topic.apply 不清几何）。
 */
const plans = hvacPlanOptions(load(hvacRaw));

function schemeToOption(plan: (typeof plans)[number]): TopicOption {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price_per_unit,
    data: plan.data,
  };
}

export class HvacTopic implements Topic {
  id = 'hvac';
  name = '空调方案';
  options = plans.map(schemeToOption);

  apply(scene: SceneApi, optionId: string): string[] {
    if (!plans.some((plan) => plan.id === optionId)) return [];
    // HVAC 实体由 render-facts projection 的专用渲染器管理；topic 仅保留选择和预算信息。
    scene.clearTopicObjects(this.id);
    return [];
  }

  validate(scene: SceneApi, optionId: string): string[] {
    const plan = plans.find((p) => p.id === optionId);
    if (!plan) return ['未知 HVAC 方案'];
    const warnings: string[] = [];
    const platformId = scene.getPlatformRoomId();
    const platformRoom = platformId ? scene.getRoom(platformId) : undefined;
    const platformWidth = platformRoom?.width ?? 1.6;
    const platformUnits = plan.outdoorUnits.filter((u) => u.location === 'platform');
    if (platformUnits.length > 1) {
      const totalW = platformUnits.reduce((sum, u) => sum + u.w, 0);
      if (totalW > platformWidth - 0.1) {
        warnings.push(`西平台宽度 ${platformWidth}m，${platformUnits.length} 台外机并排约 ${totalW.toFixed(2)}m，摆放紧张或放不下。`);
      }
    }
    return warnings;
  }
}
