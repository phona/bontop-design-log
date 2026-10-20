import * as path from 'node:path';

const ROOT_SEGMENTS = new Set([
  'app', 'assets', 'cad', 'config', 'contracts', 'data', 'docs', 'renders',
  'schedule', 'scripts', 'server', 'shared', 'survey', 'tests',
]);

const REPO_PATH_TOKEN = /\b(?:app|assets|cad|config|contracts|data|docs|renders|schedule|scripts|server|shared|survey|tests)\/[A-Za-z0-9_.~@+/-]+/g;

export function markdownDestinations(text: string): string[] {
  const out: string[] = [];
  const inline = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;
  let match: RegExpExecArray | null;
  while ((match = inline.exec(text)) !== null) out.push(match[1] ?? match[2]);

  const definitions = /^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm;
  while ((match = definitions.exec(text)) !== null) out.push(match[1] ?? match[2]);
  return out;
}

export function rootedPathTokens(text: string): string[] {
  const matches = text.match(REPO_PATH_TOKEN) ?? [];
  return matches.map((value) => value.replace(/[.,;:!?)}\]>'"`]+$/g, ''));
}

export function metadataPathTokens(text: string): string[] {
  const rooted = rootedPathTokens(text);
  const relative = text.match(/(?:^|[\s"'`([{])((?:\.\.\/|\.\/)?(?:evidence|artifacts?|renders)\/[A-Za-z0-9_.~@+/-]+\.[A-Za-z0-9]{1,8})/g) ?? [];
  return [...rooted, ...relative.map((match) => match.trim().replace(/^["'`([{]+/, ''))];
}

export function isEphemeralPath(value: string): boolean {
  return value.replaceAll('\\', '/').startsWith('tmp/');
}

export function looksLikeLocalPath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/').split(/[?#]/, 1)[0];
  if (!normalized || /^(?:https?:|mailto:|data:|tel:)/i.test(normalized)) return false;
  if (isEphemeralPath(normalized)) return true;
  const first = normalized.replace(/^\.\//, '').split('/')[0];
  if (ROOT_SEGMENTS.has(first)) return true;
  return normalized.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(normalized);
}

export function markdownPathCandidates(repoRoot: string, sourceRel: string, target: string): string[] {
  const clean = target.trim().replace(/^<|>$/g, '').split(/[?#]/, 1)[0];
  if (!clean || isEphemeralPath(clean)) return [];
  const normalized = clean.replaceAll('\\', '/');
  const first = normalized.replace(/^\.\//, '').split('/')[0];
  if (ROOT_SEGMENTS.has(first)) return [path.resolve(repoRoot, normalized)];
  return [path.resolve(repoRoot, path.dirname(sourceRel), normalized)];
}

export function metadataPathCandidates(repoRoot: string, sourceRel: string, target: string): string[] {
  const clean = target.trim().replace(/^<|>$/g, '').split(/[?#]/, 1)[0];
  if (!clean || isEphemeralPath(clean)) return [];
  const normalized = clean.replaceAll('\\', '/');
  const first = normalized.replace(/^\.\//, '').split('/')[0];
  if (ROOT_SEGMENTS.has(first)) return [path.resolve(repoRoot, normalized)];

  const candidates = [path.resolve(repoRoot, path.dirname(sourceRel), normalized)];
  const parts = sourceRel.replaceAll('\\', '/').split('/');
  const marker = parts.findIndex((part, index) => part === 'design-iterations' && index + 1 < parts.length);
  if (marker >= 0) {
    const iterationIndex = parts[marker + 1] === 'archive' ? marker + 2 : marker + 1;
    if (parts[iterationIndex]) candidates.push(path.resolve(repoRoot, ...parts.slice(0, iterationIndex + 1), normalized));
  }
  candidates.push(path.resolve(repoRoot, normalized));
  return [...new Set(candidates)];
}

export function movedArchiveIteration(
  target: string,
  directoryExists: (relativePath: string) => boolean,
): string | undefined {
  const marker = 'docs/design-iterations/';
  if (!target.startsWith(marker)) return undefined;
  const parts = target.slice(marker.length).split('/').filter(Boolean);
  if (parts.length === 0 || parts[0] === 'archive') return undefined;
  const iteration = parts[0];
  const current = `docs/design-iterations/${iteration}`;
  const archived = `docs/design-iterations/archive/${iteration}`;
  return !directoryExists(current) && directoryExists(archived) ? iteration : undefined;
}

export function targetExists(candidates: string[], exists: (absolutePath: string) => boolean): boolean {
  return candidates.some(exists);
}
