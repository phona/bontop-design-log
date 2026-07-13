import { describe, it, expect } from 'vitest';

describe('HvacTopic', () => {
  it('should not have hardcoded PLATFORM_ROOM_ID', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/topics/HvacTopic.ts', 'utf8');
    expect(source).not.toContain("PLATFORM_ROOM_ID = 'west_platform'");
  });
});
