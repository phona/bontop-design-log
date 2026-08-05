export interface ElectricalPoint {
  id: string;
  room: string;
  wall: string;
  type: 'socket' | 'switch' | 'switch_2way' | 'network' | 'usb' | 'floor_socket';
  x: number;
  z: number;
  height: number;
  count?: number;
  note?: string;
}

export interface PlumbingPoint {
  id: string;
  room: string;
  type: 'faucet' | 'toilet' | 'shower' | 'drain' | 'washer' | 'faucet_outdoor';
  x: number;
  z: number;
  height?: number;
  note?: string;
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

    const byWall = new Map<string, ElectricalPoint[]>();
    for (const p of electrical) {
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

  private _dist2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
}
