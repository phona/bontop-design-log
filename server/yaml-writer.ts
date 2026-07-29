import { writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dump as toYaml } from 'js-yaml';

export function backupPath(original: string): string {
  return `${original}.bak`;
}

export async function writeYaml(path: string, data: unknown): Promise<void> {
  if (existsSync(path)) {
    copyFileSync(path, backupPath(path));
  }

  const yaml = toYaml(data, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });

  writeFileSync(path, yaml, 'utf8');
}
