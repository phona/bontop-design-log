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
});
