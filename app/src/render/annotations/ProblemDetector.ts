/**
 * 点位数据契约（2026-11-07 issue #98 S1）：**x/z 必须是解析后坐标**。
 *
 * 定位声明走 shared/point-placement.ts 单一解算（along/wall_side/face_offset/absolute），
 * 由调用方（AnnotationRenderer）解算后喂进来——本检测器不再自己读声明 x/z 这个第二事实源。
 * 权威判定在 shared/mep-hvac-lint.ts（endpoint_inaccessible / mep_endpoint_service_conflict，
 * 同一解算器、真实家具几何）；本类是页面侧的粗筛（AABB + 0.2m 容差），且 detectAll 当前没有
 * 页面调用方，只被 tests/app/render/problem-detector.test.ts 覆盖。
 */
export interface ElectricalPoint {
  id: string;
  room: string;
  wall?: string;
  type: 'socket' | 'switch' | 'switch_2way' | 'network' | 'usb' | 'floor_socket' | 'ac_controller'
    | 'ceiling_light' | 'pendant' | 'dome' | 'wall_lamp' | 'downlight' | 'led_strip';
  x: number;
  z: number;
  height: number;
  count?: number;
  note?: string;
  temp?: number;
}

export interface PlumbingPoint {
  id: string;
  room: string;
  type: 'faucet' | 'toilet' | 'shower' | 'shower_inlet' | 'drain' | 'washer' | 'faucet_outdoor';
  x: number;
  z: number;
  height?: number;
  note?: string;
  /** 沿墙位置由同墙宿主花洒派生（混水阀冷水接口）；豁免判定用它确认配对关系与声明间距。 */
  along_host?: { id: string; offset: number };
}

export interface CeilingZone {
  id: string;
  room: string;
  type: 'drop' | 'integrated' | 'cove' | 'none' | 'ac_indoor' | 'aluminum_buckle';
  thickness?: number;
  area?: [number, number, number, number];
  x?: number;
  z?: number;
  height?: number;
  model?: string;
  note?: string;
}

export interface Problem {
  type: 'socket_blocked' | 'pipe_through_structure' | 'ac_ceiling_conflict' | 'point_overlap';
  severity: 'warning' | 'error';
  message: string;
  position: { x: number; y: number; z: number };
}

export interface FurnitureItem {
  type: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation?: number;
}

export interface WallInfo {
  id: string;
  wallType: 'interior' | 'structure' | 'curtain';
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export class ProblemDetector {
  detectAll(
    electrical: ElectricalPoint[],
    plumbing: PlumbingPoint[],
    ceiling: CeilingZone[],
    furniture: FurnitureItem[],
    walls: WallInfo[],
  ): Problem[] {
    return [
      ...this.checkSocketBehindFurniture(electrical, furniture),
      ...this.checkPipeThroughStructure(plumbing, walls),
      ...this.checkACCeilingConflict(ceiling),
      ...this.checkPointOverlap(electrical, plumbing),
    ];
  }

  checkSocketBehindFurniture(sockets: ElectricalPoint[], furniture: FurnitureItem[]): Problem[] {
    const problems: Problem[] = [];
    for (const socket of sockets) {
      for (const item of furniture) {
        if (this._isPointNearFurniture(socket.x, socket.z, item)) {
          problems.push({
            type: 'socket_blocked',
            severity: 'warning',
            message: `Socket ${socket.id} behind ${item.type}`,
            position: { x: socket.x, y: socket.height, z: socket.z },
          });
        }
      }
    }
    return problems;
  }

  /** Placeholder: logs wall types but returns empty until structure walls exist in model */
  checkPipeThroughStructure(_pipes: PlumbingPoint[], _walls: WallInfo[]): Problem[] {
    return [];
  }

  /** Placeholder: returns empty until AC vs ceiling logic is defined */
  checkACCeilingConflict(_ceiling: CeilingZone[]): Problem[] {
    return [];
  }

  checkPointOverlap(electrical: ElectricalPoint[], plumbing: PlumbingPoint[]): Problem[] {
    const problems: Problem[] = [];

    // 无墙引用的点位（absolute/mount）不参与「同墙重叠」分组——它们的位置与墙无关
    const byWall = new Map<string, ElectricalPoint[]>();
    for (const p of electrical) {
      if (!p.wall) continue;
      const list = byWall.get(p.wall);
      if (list) {
        list.push(p);
      } else {
        byWall.set(p.wall, [p]);
      }
    }

    for (const points of byWall.values()) {
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          if (this._dist2d(points[i], points[j]) < 0.2) {
            problems.push({
              type: 'point_overlap',
              severity: 'error',
              message: `Electrical points ${points[i].id} and ${points[j].id} overlap on ${points[i].wall}`,
              position: {
                x: (points[i].x + points[j].x) / 2,
                y: 1.5,
                z: (points[i].z + points[j].z) / 2,
              },
            });
          }
        }
      }
    }

    for (let i = 0; i < plumbing.length; i++) {
      for (let j = i + 1; j < plumbing.length; j++) {
        // 混水阀冷水接口与花洒本体相距 150mm 是标准间距（设计使然），不是重叠；但只豁免
        // 「接口的 along_host 确实指向该花洒、且实测间距与声明 offset 相符（容差 0.02m）」
        // 的配对。接口误移、与另一套花洒碰撞、或两点重合时，仍按 0.2m 判定（Codex review
        // 5938169611 minor：此前按类型组合一律豁免，同坐标也不报）。
        const pair = [plumbing[i].type, plumbing[j].type].sort().join('+');
        if (pair === 'shower+shower_inlet' && this._isDeclaredMixerPair(plumbing[i], plumbing[j])) continue;
        if (this._dist2d(plumbing[i], plumbing[j]) < 0.2) {
          problems.push({
            type: 'point_overlap',
            severity: 'error',
            message: `Plumbing points ${plumbing[i].id} and ${plumbing[j].id} overlap`,
            position: {
              x: (plumbing[i].x + plumbing[j].x) / 2,
              y: 1.5,
              z: (plumbing[i].z + plumbing[j].z) / 2,
            },
          });
        }
      }
    }

    for (const e of electrical) {
      for (const p of plumbing) {
        if (this._dist2d(e, p) < 0.2) {
          problems.push({
            type: 'point_overlap',
            severity: 'warning',
            message: `Electrical point ${e.id} and plumbing point ${p.id} overlap`,
            position: {
              x: (e.x + p.x) / 2,
              y: 1.5,
              z: (e.z + p.z) / 2,
            },
          });
        }
      }
    }

    return problems;
  }

  private _isPointNearFurniture(px: number, pz: number, item: FurnitureItem): boolean {
    const halfW = item.width / 2;
    const halfD = item.depth / 2;
    const xMin = item.x - halfW;
    const xMax = item.x + halfW;
    const zMin = item.z - halfD;
    const zMax = item.z + halfD;
    const tolerance = 0.2;
    return (
      px >= xMin - tolerance &&
      px <= xMax + tolerance &&
      pz >= zMin - tolerance &&
      pz <= zMax + tolerance
    );
  }

  /**
   * 混水阀配对豁免：接口（shower_inlet）的 along_host 必须指向该花洒，且两点实测平面
   * 距离与声明 offset 的绝对值相符（容差 0.02m，消浮点与面偏移噪声）。两点重合（距 0）
   * 或接口指向另一套花洒时不豁免——0.2m 重叠判定照常跑。
   */
  private _isDeclaredMixerPair(a: PlumbingPoint, b: PlumbingPoint): boolean {
    const shower = a.type === 'shower' ? a : b.type === 'shower' ? b : undefined;
    const inlet = a.type === 'shower_inlet' ? a : b.type === 'shower_inlet' ? b : undefined;
    if (!shower || !inlet || inlet.along_host === undefined) return false;
    if (inlet.along_host.id !== shower.id) return false;
    return Math.abs(this._dist2d(shower, inlet) - Math.abs(inlet.along_host.offset)) <= 0.02;
  }

  private _dist2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
}
