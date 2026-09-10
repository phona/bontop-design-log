import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BrowserSceneMaterials } from './BrowserSceneMaterials';

describe('BrowserSceneMaterials glass roles', () => {
  it('creates non-fluted Low-E glass for curtain runs (默认 opacity 快路径，无 transmission)', () => {
    const materials = new BrowserSceneMaterials();
    const material = materials.makeLowEGlassMaterial();

    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(material.transmission).toBe(0);
    expect(material.roughnessMap).toBeNull();
    expect(material.bumpMap).toBeNull();
    expect(material.transparent).toBe(true);
  });

  it('高保真开关对已创建的玻璃材质原地生效/还原', () => {
    const materials = new BrowserSceneMaterials();
    const lowE = materials.makeLowEGlassMaterial();
    const shower = materials.makeShowerScreenMaterial();

    expect(lowE.transmission).toBe(0);
    expect(shower.transmission).toBe(0);
    expect(materials.glassHighFidelityEnabled).toBe(false);

    materials.setGlassHighFidelity(true);
    expect(materials.glassHighFidelityEnabled).toBe(true);
    expect(lowE.transmission).toBeGreaterThan(0.9);
    expect(lowE.ior).toBeCloseTo(1.5);
    expect(shower.transmission).toBeGreaterThan(0.9);
    expect(shower.thickness).not.toBe(lowE.thickness);

    materials.setGlassHighFidelity(false);
    expect(lowE.transmission).toBe(0);
    expect(shower.transmission).toBe(0);
  });

  it('高保真开启后新建的玻璃直接带 transmission', () => {
    const materials = new BrowserSceneMaterials();
    materials.setGlassHighFidelity(true);
    const material = materials.makeLowEGlassMaterial();
    expect(material.transmission).toBeGreaterThan(0.9);
  });

  it('keeps shower screen glass independent from Low-E glass', () => {
    const materials = new BrowserSceneMaterials();
    materials.setGlassHighFidelity(true);
    const lowE = materials.makeLowEGlassMaterial();
    const shower = materials.makeShowerScreenMaterial();

    expect(shower).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(shower).not.toBe(lowE);
    expect(shower.thickness).not.toBe(lowE.thickness);
    expect(shower.opacity).not.toBe(lowE.opacity);
  });

  it('keeps fluted texture on sliding-door glass only', () => {
    const canvas = { getContext: vi.fn(() => ({ fillStyle: '', fillRect: vi.fn() })) };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    const materials = new BrowserSceneMaterials();
    const fluted = materials.makeFlutedGlassMaterial(1.2);
    const lowE = materials.makeLowEGlassMaterial();

    expect(fluted.roughnessMap).not.toBeNull();
    expect(fluted.bumpMap).not.toBeNull();
    expect(lowE.roughnessMap).toBeNull();
    expect(lowE.bumpMap).toBeNull();
    materials.dispose();
    vi.unstubAllGlobals();
  });
});