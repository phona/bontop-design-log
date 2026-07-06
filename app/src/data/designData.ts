import { load } from 'js-yaml';
import type { MaterialItem, MaterialsYaml, TopicOption } from '@shared/types';
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
      pros: [m.notes, `供应商：${m.supplier}`].filter(Boolean),
      cons: m.status !== 'candidate' ? ['状态非候选'] : [],
      data: m,
    }));
}

function ensureColor(options: TopicOption[], fallbackMap: Record<string, string>): TopicOption[] {
  return options.map((opt) => {
    if (opt.color) return opt;
    const m = opt.data as MaterialItem | undefined;
    if (m && fallbackMap[m.name]) {
      return { ...opt, color: fallbackMap[m.name] };
    }
    return { ...opt, color: fallbackMap[opt.name] ?? '#cccccc' };
  });
}

const floorColors: Record<string, string> = {
  '浅胡桃木纹砖': '#c49a6c',
};

const wallColors: Record<string, string> = {
  '厨卫白色釉面砖': '#f5f5f5',
};

const paintColors: Record<string, string> = {
  '金装净味五合一': '#f7f5ef',
};

export const floorOptions = ensureColor(byCategory('地砖'), floorColors);
export const wallOptions = ensureColor(byCategory('墙砖'), wallColors);
export const paintOptions = ensureColor(byCategory('乳胶漆'), paintColors);

export const materialCategories: Record<string, TopicOption[]> = {
  floor: floorOptions,
  wall: wallOptions,
  paint: paintOptions,
};

export function getMaterialOptions(): Record<string, TopicOption[]> {
  return materialCategories;
}
