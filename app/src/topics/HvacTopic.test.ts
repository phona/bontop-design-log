import { describe, it, expect } from 'vitest';

describe('HvacTopic', () => {
  it('keeps selection/validation but no longer fabricates room-centered geometry', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/topics/HvacTopic.ts', 'utf8');
    expect(source).not.toContain("PLATFORM_ROOM_ID = 'west_platform'");
    expect(source).not.toContain('createOutdoorUnit');
    expect(source).not.toContain('createIndoorUnit');
    expect(source).not.toContain('mesh.position.set(room.x');
    expect(source).toContain('validate(scene: SceneApi');
  });
});
