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
    expect(source).toMatch(/async\s+captureFloorPlan\s*\(\s*options\s*:\s*CaptureOptions\s*=\s*\{\s*\}\s*\)\s*:\s*Promise\s*<\s*string\s*>/);
    // 截图渲染 scene（灯光在 scene 上），默认隐藏 viewOnlyRoot/topicGroup，
    // 保证默认画面只含 HOUSE_EXPORT 内容且不是全黑。
    expect(source).toContain("this.renderer.render(this.scene, orthoCam)");
    expect(source).toContain('options.bounds ?? this.topDownLayoutBounds');
    expect(source).toContain("options.view === 'high-perspective'");
    expect(source).toContain('await this.whenReady()');
    expect(source).toContain('includeFurniture');
    expect(source).toContain('includeViewOnly');
  });
});

describe('HouseScene room audit capture', () => {
  it('keeps explicit guest-bath audit bounds and view options in the public API', async () => {
    const fs = await import('node:fs');
    const app = fs.readFileSync('./src/App.ts', 'utf8');
    expect(app).toContain('captureRoomAudit');
    expect(app).toContain('RoomAuditCaptureOptions');
  });

  it('draws the audit image from declared layout/config geometry with scene fallback', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toContain('this.auditSceneElements.find');
    expect(source).toContain('this.auditFurnishings.guest_bath');
    expect(source).toContain("points('shower_screen_gbath')");
    expect(source).toContain("points('gbath_west_glass_door')");
    expect(source).toContain("findAuditObject('furniture:guest_bath:vanity:0')");
    expect(source).toContain("findAuditObject('furniture:guest_bath:toilet:1')");
    expect(source).toContain('this.auditPlumbing');
    expect(source).toContain('toiletBox?.minX.toFixed(3)');
    expect(source).toContain('台盆正面←西');
    expect(source).toContain('马桶朝西');
    expect(source).toContain('花洒朝西');
    expect(source).toContain('西侧玻璃门←向北开启');
    expect(source).toContain('const clamp =');
    expect(source).toContain("ctx.fillStyle = '#000000'");
    expect(source).toContain('ctx.measureText(text)');
    expect(source).toContain('width - margin - metrics.width / 2');
    expect(source).toContain('ctx.lineWidth = 18');
    expect(source).toContain('玻璃隔断 z=');
    expect(source).toContain('西侧玻璃门');
    expect(source).toContain('向北开启');
    expect(source).toContain('南墙 z=');
    expect(source).toContain('南侧开放边');
    expect(source).toContain('北 ↑');
    expect(source).toContain('东 →');
    expect(source).toContain("'#075bd5'");
    expect(source).toContain("'rgba(34, 197, 94, 0.42)'");
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
