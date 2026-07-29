import { load } from 'js-yaml';
import type { MaterialItem, MaterialsYaml, TopicOption } from '@shared/types';
import { createMaterialTexture } from '../render/TextureFactory';
import materialsRaw from '../../../config/materials.yaml?raw';

const materialsData = load(materialsRaw) as MaterialsYaml;

function byCategory(category: string): TopicOption[] {
  return materialsData.materials
    .filter((m: MaterialItem) => m.category === category)
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

export const floorOptions = ensureAppearance(byCategory('地砖'));
export const wallOptions = ensureAppearance(byCategory('墙砖'));
export const paintOptions = ensureAppearance(byCategory('乳胶漆'));
export const cabinetOptions = ensureAppearance(byCategory('柜体板材'));
export const countertopOptions = ensureAppearance(byCategory('台面'));
export const sanitaryOptions = ensureAppearance(byCategory('卫浴洁具'));
export const interiorDoorOptions = [
  ...ensureAppearance(byCategory('室内门')),
  ...ensureAppearance(byCategory('卫生间门')),
  ...ensureAppearance(byCategory('入户门')),
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
