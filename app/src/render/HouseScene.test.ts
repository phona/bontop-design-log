import { describe, it, expect } from 'vitest';

describe('HouseScene', () => {
  it('should read openings from room config, not hardcoded', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).not.toContain("r.id === 'living_dining'");
    expect(source).not.toContain("r.id === 'south_balcony'");
  });
});

describe('HouseScene scene elements', () => {
  it('renders by declared type only — no curtain boolean, no position-based classification', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).not.toContain('userData.curtain');
    expect(source).not.toContain('curtain?:');
    expect(source).toContain("case 'curtain_run'");
    expect(source).toContain("case 'glass_infill'");
    expect(source).toContain("case 'wall_run'");
    expect(source).toContain("case 'wall'");
  });

  it('house.walls is no longer consumed — sceneElements is the only wall source', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).not.toContain('house.walls');
    expect(source).toContain('sceneElements');
  });

  it('floor topic also retextures floor_region strips (corridor follows living floor, DEC-011)', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toContain('applyToFloorRegions');
  });

  it('glass material exports as real glass: transmission (KHR_materials_transmission), zero metalness', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    const block = source.match(/makeGlassMaterial\(\)[^{]*\{([\s\S]*?)\n  \}/);
    expect(block).not.toBeNull();
    expect(block![1]).toContain('transmission');
    expect(block![1]).toContain('metalness: 0');
    expect(block![1]).not.toContain('metalness: 0.1');
  });

  it('rect rooms (PlaneGeometry branch) rescale UV to meters — wood_plank worldSize assumption holds for all rooms', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toContain('scalePlaneUvToMeters');
  });

  it('curtains offset 12cm interior — sheer must not be coplanar with glass (z-fighting)', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toContain('offsetCurtainPointsInterior');
    expect(source).toContain('0.12');
  });
});

describe('HouseScene captureFloorPlan', () => {
  it('exposes a captureFloorPlan method that returns a Promise', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toContain('captureFloorPlan');
    expect(source).toMatch(/async\s+captureFloorPlan\s*\(\s*\)\s*:\s*Promise\s*<\s*string\s*>/);
  });
});

describe('HouseScene ceiling zones', () => {
  it('renders solid ceiling zones via buildCeilingZone and registers meshes in ceilingMeshes', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toContain('buildCeilingZone');
    expect(source).toContain('loadCeilingZones');
    expect(source).toContain("'/api/annotations/ceiling'");
    expect(source).toContain("ceiling_zone_solid: '吊顶'");
  });

  it('ceiling zone meshes follow first-person-only visibility', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toMatch(/renderCeilingZones[\s\S]*ceilingMeshes\.push/);
    expect(source).toContain('setCeilingVisible(this._mode');
  });
});
