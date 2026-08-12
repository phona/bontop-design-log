import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { InteriorLightingSystem, type InteriorLightPoint } from './InteriorLightingSystem';

const POINTS: InteriorLightPoint[] = [
  { id: 'p1', room: 'living_dining', type: 'pendant', x: 8.5, z: 3.35, height: 2.8 },
  { id: 'p2', room: 'living_dining', type: 'pendant', x: 10.3, z: 7.0, height: 2.8 },
  { id: 'p3', room: 'master_bedroom', type: 'pendant', x: 2.6, z: 7.6, height: 2.8 },
  { id: 'd1', room: 'master_bedroom', type: 'dome', x: 2.6, z: 7.6, height: 2.8 },
  { id: 'w1', room: 'master_bedroom', type: 'wall_lamp', x: 4.2, z: 7.2, height: 1.6 },
  { id: 's1', room: 'living_dining', type: 'downlight', x: 5.7, z: 4.9, height: 2.8 },
  { id: 't1', room: 'living_dining', type: 'led_strip', x: 7.2, z: 7.0, height: 2.0 },
  { id: 'k1', room: 'kitchen', type: 'dome', x: 9.0, z: 1.2, height: 2.8, temp: 4000 },
  { id: 'x1', room: 'kitchen', type: 'socket', x: 9.0, z: 0.3, height: 0.3 }, // 非灯光点位应被忽略
];

function makeSystem(points = POINTS) {
  const scene = new THREE.Scene();
  const sys = new InteriorLightingSystem(scene, points);
  return { scene, sys };
}

describe('InteriorLightingSystem', () => {
  it('按灯光类型建光源，非灯光点位被忽略', () => {
    const { sys } = makeSystem();
    expect(sys.lightCount).toBe(8); // 9 个点位减去 1 个 socket
  });

  it('投影光源数量 ≤2（pendant 优先，超出不投影）', () => {
    const { sys } = makeSystem();
    expect(sys.shadowLightCount).toBe(2); // 3 个 pendant，只前 2 个投影
  });

  it('toggle 全局开关并联动光源 visible', () => {
    const { scene, sys } = makeSystem();
    expect(sys.isOn).toBe(false);
    sys.toggle();
    expect(sys.isOn).toBe(true);
    const lights = scene.children.filter((c) => c instanceof THREE.PointLight || c instanceof THREE.SpotLight);
    void lights; // 光源在 group 内
    const group = scene.children.find((c) => c instanceof THREE.Group) as THREE.Group;
    const inner = group.children.filter((c) => c instanceof THREE.Light) as THREE.Light[];
    expect(inner.length).toBe(8);
    expect(inner.every((l) => l.visible)).toBe(true);
    sys.toggle();
    expect(inner.every((l) => !l.visible)).toBe(true);
  });

  it('setRoomLights 只影响指定房间', () => {
    const { scene, sys } = makeSystem();
    sys.setOn(true);
    sys.setRoomLights('kitchen', false);
    const group = scene.children.find((c) => c instanceof THREE.Group) as THREE.Group;
    const inner = group.children.filter((c) => c instanceof THREE.Light) as THREE.Light[];
    const kitchenLight = inner.find((l) => Math.abs(l.position.x - 9.0) < 0.01 && Math.abs(l.position.z - 1.2) < 0.01)!;
    expect(kitchenLight.visible).toBe(false);
    expect(inner.filter((l) => l !== kitchenLight).every((l) => l.visible)).toBe(true);
  });

  it('syncSolar：夜晚或低太阳高度角自动开灯，白天关灯', () => {
    const { sys } = makeSystem();
    sys.syncSolar({ isNight: true, altitudeDeg: -20 });
    expect(sys.isOn).toBe(true);
    sys.syncSolar({ isNight: false, altitudeDeg: 5 });
    expect(sys.isOn).toBe(true);
    sys.syncSolar({ isNight: false, altitudeDeg: 45 });
    expect(sys.isOn).toBe(false);
  });

  it('dispose 从场景移除', () => {
    const { scene, sys } = makeSystem();
    const before = scene.children.length;
    expect(before).toBeGreaterThan(0);
    sys.dispose();
    expect(scene.children.length).toBe(0);
  });
});
