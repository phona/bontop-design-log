import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BrowserSceneMaterials } from './BrowserSceneMaterials';

describe('BrowserSceneMaterials glass roles', () => {
  it('creates non-fluted Low-E glass for curtain runs', () => {
    const materials = new BrowserSceneMaterials();
    const material = materials.makeLowEGlassMaterial();

    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(material.transmission).toBeGreaterThan(0.9);
    expect(material.roughnessMap).toBeNull();
    expect(material.bumpMap).toBeNull();
    expect(material.transparent).toBe(true);
  });

  it('keeps shower screen glass independent from Low-E glass', () => {
    const materials = new BrowserSceneMaterials();
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