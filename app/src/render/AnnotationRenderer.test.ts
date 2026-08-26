import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AnnotationRenderer } from './annotations/AnnotationRenderer';

function makeCanvasContext(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    font: '',
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('AnnotationRenderer ceiling object ids', () => {
  it('tags ceiling zone indicators and AC icons as ceiling annotations', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(makeCanvasContext());
    try {
      const scene = new THREE.Scene();
      const renderer = new AnnotationRenderer(scene, new THREE.PerspectiveCamera());
      (renderer as any).renderCeiling([
        { id: 'ceiling_entry_foyer', room: 'entry_garden', type: 'drop', area: [10, 2, 12, 4], thickness: 0.3 },
        { id: 'ac_entry', room: 'entry_garden', type: 'ac_indoor', x: 11, z: 3, height: 2.85 },
      ]);

      const ceilingLayer = (renderer as any).layerGroups.ceiling as THREE.Group;
      expect(ceilingLayer.children.map((child) => child.userData)).toEqual([
        expect.objectContaining({
          type: 'annotation',
          category: 'ceiling',
          objectId: 'ceiling:ceiling_entry_foyer',
        }),
        expect.objectContaining({
          type: 'annotation',
          category: 'ceiling',
          objectId: 'ceiling:ac_entry',
        }),
      ]);
      expect(ceilingLayer.children.every((child) => child.userData.type !== 'lighting_fixture')).toBe(true);
    } finally {
      getContext.mockRestore();
    }
  });
});
