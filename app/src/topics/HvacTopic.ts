import * as THREE from 'three';
import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { hvacSchemes } from '@shared/houseData';

const PLATFORM_ROOM_ID = 'west_platform';
import { createOutdoorUnit, createIndoorUnit, createLabel } from '../render/ObjectFactory.js';

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
    const scheme = hvacSchemes.find((s) => s.id === optionId);
    if (!scheme) return [];

    scene.clearTopicObjects(this.id);
    const objectIds: string[] = [];

    const resolveLocation = (location: string) =>
      location === 'platform' ? scene.getRoom(PLATFORM_ROOM_ID) : scene.getRoom(location);

    // outdoor units
    scheme.outdoorUnits.forEach((unit, idx) => {
      const loc = resolveLocation(unit.location);
      if (!loc) return;
      const mesh = createOutdoorUnit(unit.w, unit.h, unit.d);
      const xOffset = scheme.outdoorUnits.length > 1 ? (idx - (scheme.outdoorUnits.length - 1) / 2) * (unit.w + 0.05) : 0;
      mesh.position.set(loc.x + xOffset, unit.h / 2 + 0.15, loc.z);
      const objectId = `hvac:outdoor:${scheme.id}:${idx}`;
      scene.addObject(this.id, objectId, mesh);
      objectIds.push(objectId);

      const label = createLabel(`${scheme.id} 外机#${idx + 1}`);
      label.position.set(mesh.position.x, mesh.position.y + unit.h / 2 + 0.4, mesh.position.z);
      scene.addObject(this.id, `${objectId}:label`, label);
    });

    // indoor units
    scheme.indoorUnits.forEach((unit, idx) => {
      const room = scene.getRoom(unit.roomId);
      if (!room) return;
      const objectId = `hvac:indoor:${scheme.id}:${unit.roomId}`;
      if (unit.type === 'ceiling') {
        const mesh = createIndoorUnit('ceiling', 0.8, 0.5, 0.2);
        mesh.position.set(room.x, room.height - 0.15, room.z);
        scene.addObject(this.id, objectId, mesh);
      } else if (unit.type === 'wall') {
        const mesh = createIndoorUnit('wall', 0.8, 0.25, 0.25);
        mesh.position.set(room.x, room.height * 0.65, room.z - room.depth / 2 + 0.15);
        scene.addObject(this.id, objectId, mesh);
      } else {
        const mesh = createIndoorUnit('cabinet', 0.55, 0.35, 1.7);
        mesh.position.set(room.x - 1, 0.85, room.z - 1);
        scene.addObject(this.id, objectId, mesh);
      }
      objectIds.push(objectId);

      const label = createLabel(`${unit.type === 'ceiling' ? '吊顶' : unit.type === 'wall' ? '壁挂' : '柜机'}`);
      const labelPos = new THREE.Vector3(room.x, room.height - 0.5, room.z);
      label.position.copy(labelPos);
      scene.addObject(this.id, `${objectId}:label`, label);
    });

    return objectIds;
  }

  validate(scene: SceneApi, optionId: string): string[] {
    const scheme = hvacSchemes.find((s) => s.id === optionId);
    if (!scheme) return ['未知 HVAC 方案'];
    const warnings: string[] = [];
    const platformRoom = scene.getRoom(PLATFORM_ROOM_ID);
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
