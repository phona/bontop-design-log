export interface KeyBinding {
  key: string;
  code: string;
  description: string;
  category: '视角' | '移动' | '编辑' | '工具';
  mode?: 'all' | 'first-person' | 'orbit' | 'top-down';
  shiftKey?: boolean;
}

export const KEY_BINDINGS: KeyBinding[] = [
  // 视角
  { key: 'V', code: 'KeyV', description: '切换视角模式', category: '视角', mode: 'all' },
  { key: 'Tab', code: 'Tab', description: '切换方案对比', category: '视角', mode: 'all' },
  { key: 'M', code: 'KeyM', description: '打开总览菜单', category: '视角', mode: 'all' },

  // 移动（FP）
  { key: 'W / A / S / D', code: '', description: '前后左右行走', category: '移动', mode: 'first-person' },

  // 编辑
  { key: 'G', code: 'KeyG', description: '拖拽选中物体', category: '编辑', mode: 'first-person' },
  { key: 'B', code: 'KeyB', description: '打开家具面板', category: '编辑', mode: 'first-person' },
  { key: 'E', code: 'KeyE', description: '新增电气/给排水点位', category: '编辑', mode: 'first-person' },
  { key: 'Delete', code: 'Delete', description: '删除选中点位', category: '编辑', mode: 'first-person' },

  // 工具
  { key: 'W', code: 'KeyW', description: '透视图（X-ray）', category: '工具', mode: 'orbit' },
  { key: 'P', code: 'KeyP', description: '开关标注标签', category: '工具', mode: 'all' },
  { key: 'L', code: 'KeyL', description: '开关测量工具', category: '工具', mode: 'all' },
  { key: 'C', code: 'KeyC', description: '循环全屋窗帘状态', category: '工具', mode: 'all' },
  { key: '[', code: 'BracketLeft', description: '降低鼠标灵敏度', category: '工具', mode: 'first-person' },
  { key: ']', code: 'BracketRight', description: '提高鼠标灵敏度', category: '工具', mode: 'first-person' },
  { key: '?', code: 'Slash', description: '打开命令面板', category: '工具', mode: 'all', shiftKey: true },
];

export function findBinding(code: string, shiftKey?: boolean): KeyBinding | undefined {
  return KEY_BINDINGS.find((b) => b.code === code && (b.shiftKey ?? false) === (shiftKey ?? false));
}
