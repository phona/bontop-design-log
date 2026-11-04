/**
 * 极简 ASCII DXF R12（AC1009）写出器 —— 项目唯一的 DXF 生成实现。
 *
 * 依据（2026-11-03 业主拍板）：导出为独立新图，1:1 毫米，不对齐开发商原图坐标；
 * 单文件多图层。实体只覆盖平面图所需：LINE / CIRCLE / ARC / TEXT（折线按段拆 LINE）。
 *
 * 编码口径：图层名全 ASCII（R12 无可靠 unicode 图层语义）；TEXT 内容原样 UTF-8 写出、
 * $DWGCODEPAGE 声明 ANSI_936。中望/浩辰对 UTF-8 DXF 宽容；若业主 CAD 乱码，
 * buildProjectDxf 的 labels: 'ascii' 开关退回纯 ASCII 标注（一行切换，不动物理几何）。
 */

/** DXF 组码对：[code, value]。 */
type Pair = readonly [number, string];

const LAYER_NAME_RE = /^[A-Za-z0-9\-_.$]+$/;

export class DxfWriter {
  private readonly layerOrder: string[] = [];
  private readonly layerColors = new Map<string, number>();
  private readonly entities: Pair[][] = [];
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;

  /** 图层名必须 ASCII（R12 编码安全）；color 为 ACI 色号（1 红 / 2 黄 / 3 绿 / 4 青 / 5 蓝 / 6 洋红 / 7 白）。 */
  addLayer(name: string, color = 7): void {
    if (!LAYER_NAME_RE.test(name)) {
      throw new Error(`DXF layer name must be ASCII word: ${JSON.stringify(name)}`);
    }
    if (!this.layerColors.has(name)) {
      this.layerOrder.push(name);
      this.layerColors.set(name, color);
    }
  }

  hasLayer(name: string): boolean {
    return this.layerColors.has(name);
  }

  /** 引用图层时自动补注册（防御：实体引用未注册图层是非法 DXF）。 */
  private touchLayer(layer: string, color = 7): void {
    if (!LAYER_NAME_RE.test(layer)) {
      throw new Error(`DXF layer name must be ASCII word: ${JSON.stringify(layer)}`);
    }
    if (!this.layerColors.has(layer)) {
      this.layerOrder.push(layer);
      this.layerColors.set(layer, color);
    }
  }

  private track(x1: number, y1: number, x2: number, y2: number): void {
    this.minX = Math.min(this.minX, x1, x2);
    this.minY = Math.min(this.minY, y1, y2);
    this.maxX = Math.max(this.maxX, x1, x2);
    this.maxY = Math.max(this.maxY, y1, y2);
  }

  addLine(layer: string, x1: number, y1: number, x2: number, y2: number): void {
    this.touchLayer(layer);
    this.track(x1, y1, x2, y2);
    this.entities.push([
      [0, 'LINE'],
      [8, layer],
      [10, fmt(x1)], [20, fmt(y1)], [30, '0.0'],
      [11, fmt(x2)], [21, fmt(y2)], [31, '0.0'],
    ]);
  }

  /** 折线按段拆 LINE（R12 兼容；closed 时首尾闭合）。 */
  addPolyline(layer: string, points: ReadonlyArray<readonly [number, number]>, closed = false): void {
    for (let i = 1; i < points.length; i += 1) {
      this.addLine(layer, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    }
    if (closed && points.length > 2) {
      const first = points[0];
      const last = points[points.length - 1];
      this.addLine(layer, last[0], last[1], first[0], first[1]);
    }
  }

  addCircle(layer: string, x: number, y: number, radius: number): void {
    if (!(radius > 0)) return;
    this.touchLayer(layer);
    this.track(x - radius, y - radius, x + radius, y + radius);
    this.entities.push([
      [0, 'CIRCLE'],
      [8, layer],
      [10, fmt(x)], [20, fmt(y)], [30, '0.0'],
      [40, fmt(radius)],
    ]);
  }

  addArc(layer: string, x: number, y: number, radius: number, startDeg: number, endDeg: number): void {
    if (!(radius > 0)) return;
    this.touchLayer(layer);
    // 包围盒按整圆计（弧是其子集）：EXTMIN/EXTMAX 覆盖所有实体（codex 十二审 minor）。
    this.track(x - radius, y - radius, x + radius, y + radius);
    this.entities.push([
      [0, 'ARC'],
      [8, layer],
      [10, fmt(x)], [20, fmt(y)], [30, '0.0'],
      [40, fmt(radius)],
      [50, fmt(startDeg)], [51, fmt(endDeg)],
    ]);
  }

  addText(layer: string, x: number, y: number, height: number, text: string): void {
    if (text === '') return;
    this.touchLayer(layer);
    // 文字包围盒按保守上界计（每字符占宽 = 字高，覆盖 CJK 全角）：EXTMIN/EXTMAX 含全部
    // TEXT（codex 十二审 minor）——D-NOTES 等图外说明不致被初始视图裁掉。
    const approxWidth = Math.max(text.length, 1) * height;
    this.track(x, y, x + approxWidth, y + height);
    this.entities.push([
      [0, 'TEXT'],
      [8, layer],
      [10, fmt(x)], [20, fmt(y)], [30, '0.0'],
      [40, fmt(height)],
      [1, text],
      [7, 'STANDARD'],
    ]);
  }

  /** 产出完整 DXF 文本。空图也会输出合法骨架（HEADER + TABLES + ENTITIES）。 */
  toString(): string {
    const pairs: Pair[] = [];
    const emit = (code: number, value: string): void => {
      pairs.push([code, value]);
    };

    // --- HEADER ---
    emit(0, 'SECTION');
    emit(2, 'HEADER');
    emit(9, '$ACADVER');
    emit(1, 'AC1009');
    emit(9, '$DWGCODEPAGE');
    emit(3, 'ANSI_936');
    const hasBounds = this.minX !== Infinity;
    emit(9, '$EXTMIN');
    emit(10, hasBounds ? fmt(this.minX - 100) : '0.0');
    emit(20, hasBounds ? fmt(this.minY - 100) : '0.0');
    emit(30, '0.0');
    emit(9, '$EXTMAX');
    emit(10, hasBounds ? fmt(this.maxX + 100) : '0.0');
    emit(20, hasBounds ? fmt(this.maxY + 100) : '0.0');
    emit(30, '0.0');
    emit(0, 'ENDSEC');

    // --- TABLES（线型 + 图层）---
    emit(0, 'SECTION');
    emit(2, 'TABLES');
    emit(0, 'TABLE');
    emit(2, 'LTYPE');
    emit(70, '1');
    emit(0, 'LTYPE');
    emit(2, 'CONTINUOUS');
    emit(70, '64');
    emit(3, 'Solid line');
    emit(72, '65');
    emit(73, '0');
    emit(40, '0.0');
    emit(0, 'ENDTAB');
    emit(0, 'TABLE');
    emit(2, 'LAYER');
    emit(70, String(this.layerOrder.length + 1)); // 含内建 0 层
    emit(0, 'LAYER');
    emit(2, '0');
    emit(70, '0');
    emit(62, '7');
    emit(6, 'CONTINUOUS');
    for (const name of this.layerOrder) {
      emit(0, 'LAYER');
      emit(2, name);
      emit(70, '0');
      emit(62, String(this.layerColors.get(name) ?? 7));
      emit(6, 'CONTINUOUS');
    }
    emit(0, 'ENDTAB');
    emit(0, 'ENDSEC');

    // --- ENTITIES ---
    emit(0, 'SECTION');
    emit(2, 'ENTITIES');
    for (const entity of this.entities) {
      for (const [code, value] of entity) emit(code, value);
    }
    emit(0, 'ENDSEC');
    emit(0, 'EOF');

    return pairs.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n';
  }

  /** 每图层实体计数（导出报告用）。 */
  layerStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const entity of this.entities) {
      const layer = entity.find(([code]) => code === 8)?.[1] ?? '?';
      stats[layer] = (stats[layer] ?? 0) + 1;
    }
    return stats;
  }
}

function fmt(value: number): string {
  // mm 坐标 4 位小数足够（亚微米级）；避免科学计数法（DXF R12 不认）。
  return value.toFixed(4);
}
