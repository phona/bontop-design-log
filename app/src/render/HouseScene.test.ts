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
    const houseScene = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    const sceneBuilder = fs.readFileSync('../shared/render/SceneBuilder.ts', 'utf8');
    expect(houseScene).not.toContain('userData.curtain');
    expect(houseScene).not.toContain('curtain?:');
    expect(sceneBuilder).toContain("case 'curtain_run'");
    expect(sceneBuilder).toContain("case 'glass_infill'");
    expect(sceneBuilder).toContain("case 'shower_screen'");
    expect(sceneBuilder).toContain("case 'wall_run'");
    expect(sceneBuilder).toContain("element.type === 'wall'");
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

  it('uses the shared scene builder for glass and curtain geometry', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toContain("@shared/render/SceneBuilder");
    expect(source).not.toContain('private buildCurtainShape');
    expect(source).not.toContain('private renderCurtain');
  });

  it('rect rooms (PlaneGeometry branch) rescale UV to meters — wood_plank worldSize assumption holds for all rooms', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toContain('scalePlaneUvToMeters');
  });

  it('curtain interior offset belongs to shared geometry', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('../shared/render/CurtainGeometry.ts', 'utf8');
    expect(source).toContain('offsetCurtainPointsInterior');
    expect(source).toContain('0.12');
  });
});

describe('HouseScene captureFloorPlan', () => {
  it('exposes a captureFloorPlan method that returns a Promise', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toContain('captureFloorPlan');
    expect(source).toMatch(/async\s+captureFloorPlan\s*\(\s*options\s*:\s*\{\s*includeFurniture\?\s*:\s*boolean\s*\}\s*=\s*\{\s*\}\s*\)\s*:\s*Promise\s*<\s*string\s*>/);
    // 截图渲染 scene（灯光在 scene 上），viewOnlyRoot/topicGroup 在 capture 前隐藏，
    // 保证画面只含 HOUSE_EXPORT 内容且不是全黑。
    expect(source).toContain("this.renderer.render(this.scene, orthoCam)");
    expect(source).toContain('this.viewOnlyRoot.visible = false');
    expect(source).toContain('await this.whenReady()');
    expect(source).toContain('includeFurniture');
  });
});

describe('HouseScene ceiling zones', () => {
  it('delegates ceiling zone construction to the shared scene builder without a browser fetch path', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toContain('parseSceneInput');
    expect(source).not.toContain('loadCeilingZones');
    expect(source).not.toContain("'/api/annotations/ceiling'");
    expect(source).not.toContain('buildCeilingZone');
  });

  it('ceiling zone meshes follow first-person-only visibility', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toContain('setCeilingVisible(mode === \'first-person\')');
  });
});
