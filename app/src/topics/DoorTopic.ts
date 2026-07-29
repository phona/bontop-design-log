import type { Topic, SceneApi } from '@shared/types';
import { interiorDoorOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class DoorTopic implements Topic {
  id = 'door';
  name = '门方案';
  options = interiorDoorOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    const hs = scene as unknown as HouseScene;
    const data = option.data as Record<string, unknown> | undefined;
    const appearance = (data?.appearance as { type: string; color: string; scale?: number } | undefined) ?? (option.color
      ? { type: 'wood', color: option.color, scale: 1 }
      : undefined);
    if (!appearance) return [];

    const allRoomIds = hs.getAllRoomIds();
    for (const roomId of allRoomIds) {
      hs.setDoorMaterial(roomId, appearance);
    }
    return ['door:all'];
  }

  validate(): string[] {
    return [];
  }
}
