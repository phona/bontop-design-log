import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BrowserSceneDecorations } from './BrowserSceneDecorations.js';

describe('BrowserSceneDecorations', () => {
  it('parents markers under HOUSE_VIEW_ONLY and clears them there', () => {
    const scene = new THREE.Scene();
    const decorations = new BrowserSceneDecorations(scene);
    const root = decorations.root;
    expect(root.children).toHaveLength(2);
    const [grid, ground] = root.children;
    const marker = new THREE.Object3D();
    decorations.addMarker(marker);
    expect(marker.parent).toBe(decorations.root);
    expect(scene.children).not.toContain(marker);
    decorations.clearMarkers();
    expect(marker.parent).toBeNull();
    expect(root.children).toEqual([grid, ground]);
    decorations.clearDynamic();
    expect(root.children).toEqual([grid, ground]);
    decorations.dispose();
  });
});
