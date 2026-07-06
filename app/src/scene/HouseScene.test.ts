// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../topics/TopicRegistry.js', () => ({
  TopicRegistry: class MockTopicRegistry {
    get() { return undefined; }
    list() { return []; }
    register() {}
  },
}));

const mockRenderer = {
  setSize: vi.fn(),
  render: vi.fn(),
  dispose: vi.fn(),
  domElement: document.createElement('canvas'),
};

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const MockWebGLRenderer = function(this: any) {
    Object.assign(this, mockRenderer);
  } as any;
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

import * as THREE from 'three';
import { HouseScene } from './HouseScene';

describe('HouseScene', () => {
  let canvas: HTMLCanvasElement;
  let scene: HouseScene;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });
    scene = new HouseScene(canvas);
  });

  it('should initialize Three.js scene', () => {
    expect(scene).toBeDefined();
    expect(scene.getScene()).toBeInstanceOf(THREE.Scene);
    expect(scene.getCamera()).toBeInstanceOf(THREE.PerspectiveCamera);
  });

  it('should render rooms from catalog', () => {
    const projectData = {
      house: {
        rooms: [
          { id: 'living_room', name: 'Living', x: 0, z: 0, width: 5, depth: 4, height: 3, type: 'public' },
          { id: 'bedroom', name: 'Bedroom', x: 6, z: 0, width: 4, depth: 3, height: 3, type: 'private' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };

    scene.buildFromCatalog(projectData);

    const roomObjects = scene.getScene().children.filter(
      (obj) => obj.userData.objectId?.startsWith('room:')
    );
    expect(roomObjects.length).toBe(2);
  });

  it('should create floors and walls for each room', () => {
    const projectData = {
      house: {
        rooms: [
          { id: 'kitchen', name: 'Kitchen', x: 0, z: 0, width: 3, depth: 3, height: 3, type: 'service' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };

    scene.buildFromCatalog(projectData);

    const floors = scene.getScene().children.filter(
      (obj) => obj.userData.objectId?.startsWith('floor:')
    );
    const walls = scene.getScene().children.filter(
      (obj) => obj.userData.objectId?.startsWith('wall:')
    );
    expect(floors.length).toBe(1);
    expect(walls.length).toBe(4);
  });

  it('should register object click callback', () => {
    const cb = vi.fn();
    scene.onObjectClick(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('should highlight object by id', () => {
    const projectData = {
      house: {
        rooms: [
          { id: 'test_room', name: 'Test', x: 0, z: 0, width: 3, depth: 3, height: 3, type: 'public' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    scene.buildFromCatalog(projectData);
    scene.highlightObject('room:test_room');
  });

  it('should set camera target to room', () => {
    const projectData = {
      house: {
        rooms: [
          { id: 'test_room', name: 'Test', x: 5, z: 5, width: 3, depth: 3, height: 3, type: 'public' },
        ],
      },
      topics: [],
      budgetCategories: [],
    };
    scene.buildFromCatalog(projectData);
    scene.setCameraTarget('room:test_room');
  });

  it('should render without throwing', () => {
    expect(() => scene.render()).not.toThrow();
  });
});
