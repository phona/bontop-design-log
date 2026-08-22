import { load } from 'js-yaml';
import type { MaterialItem, MaterialsYaml, TopicOption } from '@shared/types';
import { createMaterialTexture } from '../render/TextureFactory';
import materialsRaw from '../../../config/materials.yaml?raw';

const materialsData = load(materialsRaw) as MaterialsYaml;

// 按 topic_id 分组（而非中文 category），避免同 category 的不同 topic 材料互相串入
// （如 floor_tile_01 与 wall_tile_01 同属"瓷砖"，须按 topic_id 区分 floor / wall）
function byTopicId(topicId: string): TopicOption[] {
  return materialsData.materials
    .filter((m: MaterialItem) => m.topic_id === topicId)
    .map((m: MaterialItem) => ({
      id: m.id,
      name: m.name,
      description: `${m.brand} ${m.model} · ${m.price_per_unit} 元/${m.unit}`,
      price: m.price_per_unit,
      pros: m.pros ?? [],
      cons: m.cons ?? [],
      data: m,
    }));
}

function ensureAppearance(options: TopicOption[]): TopicOption[] {
  return options.map((opt) => {
    if (opt.color) return opt;
    const m = opt.data as MaterialItem | undefined;
    if (m?.appearance) {
      const tex = createMaterialTexture(m.appearance);
      return { ...opt, color: m.appearance.color, data: { ...m, texture: tex } };
    }
    return { ...opt, color: '#cccccc' };
  });
}

export const floorOptions = ensureAppearance(byTopicId('floor'));
export const wallOptions = ensureAppearance(byTopicId('wall'));
// materials.yaml 的乳胶漆条目 topic_id 为 "paint"（历史误写 'latex_paint' 导致选项列表恒为空，DEC-041 修正）
export const paintOptions = ensureAppearance(byTopicId('paint'));
export const cabinetOptions = ensureAppearance(byTopicId('cabinet'));
export const countertopOptions = ensureAppearance(byTopicId('countertop'));
export const sanitaryOptions = ensureAppearance(byTopicId('sanitary'));
export const curtainOptions = ensureAppearance(byTopicId('curtain'));
export const interiorDoorOptions = [
  ...ensureAppearance(byTopicId('interior_door')),
  ...ensureAppearance(byTopicId('bathroom_door')),
  ...ensureAppearance(byTopicId('entry_door')),
];

export const materialCategories: Record<string, TopicOption[]> = {
  floor: floorOptions,
  wall: wallOptions,
  paint: paintOptions,
  cabinet: cabinetOptions,
  countertop: countertopOptions,
  sanitary: sanitaryOptions,
  door: interiorDoorOptions,
};

export function getMaterialOptions(): Record<string, TopicOption[]> {
  return materialCategories;
}
