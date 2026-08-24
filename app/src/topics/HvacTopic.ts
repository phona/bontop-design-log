import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { hvacSchemes } from '@shared/houseData';

function schemeToOption(scheme: (typeof hvacSchemes)[number]): TopicOption {
  return {
    id: scheme.id,
    name: scheme.name,
    description: scheme.desc,
    price: scheme.price_range,
    pros: scheme.pros,
    cons: scheme.cons,
    data: scheme,
  };
}

export class HvacTopic implements Topic {
  id = 'hvac';
  name = '空调方案';
  options = hvacSchemes.map(schemeToOption);

  apply(scene: SceneApi, optionId: string): string[] {
    if (!hvacSchemes.some((scheme) => scheme.id === optionId)) return [];
    // HVAC 实体由 render-facts projection 的专用渲染器管理；topic 仅保留选择和预算信息。
    scene.clearTopicObjects(this.id);
    return [];
  }

  validate(scene: SceneApi, optionId: string): string[] {
    const scheme = hvacSchemes.find((s) => s.id === optionId);
    if (!scheme) return ['未知 HVAC 方案'];
    const warnings: string[] = [];
    const platformId = scene.getPlatformRoomId();
    const platformRoom = platformId ? scene.getRoom(platformId) : undefined;
    const platformWidth = platformRoom?.width ?? 1.6;
    const platformUnits = scheme.outdoorUnits.filter((u) => u.location === 'platform').length;
    if (platformUnits > 1) {
      const totalW = scheme.outdoorUnits
        .filter((u) => u.location === 'platform')
        .reduce((sum, u) => sum + u.w, 0);
      if (totalW > platformWidth - 0.1) {
        warnings.push(`西平台宽度 ${platformWidth}m，${platformUnits} 台外机并排约 ${totalW.toFixed(2)}m，摆放紧张或放不下。`);
      }
    }
    if (optionId === 'E1') {
      warnings.push('叠叠乐方案外机过多，散热、噪音、维修风险高，不建议。');
    }
    if (optionId === 'F2') {
      warnings.push('外机放入户花园存在噪音、热风及物业/消防风险，需现场确认。');
    }
    return warnings;
  }
}
