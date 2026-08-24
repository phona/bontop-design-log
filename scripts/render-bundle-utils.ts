import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { GlbSummary } from './inspect-glb.js';
import type { ProjectRenderFactsProjection } from '../shared/types.js';

export const RENDER_BUNDLE_SCHEMA_VERSION = '1.1';

export interface BundleArtifact {
  path: string;
  bytes: number;
  sha256: string;
}

export interface RenderBundleManifest {
  schemaVersion: typeof RENDER_BUNDLE_SCHEMA_VERSION;
  revision: string;
  dirty: boolean;
  dirtyPorcelain: string;
  sourceInputs: Record<string, string>;
  glbExport: {
    method: 'manual_web_export';
    inputBasename: string;
  };
  artifacts: {
    glb: BundleArtifact;
    renderConfig: BundleArtifact;
    projectRenderFacts: BundleArtifact;
  };
  summaries: {
    glb: GlbSummary;
    projectRenderFacts: ProjectRenderFactsProjection;
  };
}

export function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function fileArtifact(root: string, path: string): BundleArtifact {
  assertBundleRelativePath(path);
  const bytes = readFileSync(resolve(root, path));
  return { path, bytes: bytes.length, sha256: sha256Bytes(bytes) };
}

export function assertBundleRelativePath(path: string): void {
  if (!path || path.includes('\0') || path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:[\\/]/u.test(path)) {
    throw new Error(`Bundle artifact path must be relative: ${path}`);
  }
  const parts = path.split(/[\\/]/u);
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Bundle artifact path is unsafe: ${path}`);
  }
}

export function resolveBundlePath(root: string, path: string): string {
  assertBundleRelativePath(path);
  const resolved = resolve(root, path);
  const relativePath = relative(resolve(root), resolved);
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.startsWith('../')) {
    throw new Error(`Bundle artifact path escapes bundle: ${path}`);
  }
  return resolved;
}

export function git(command: string[]): string {
  return execFileSync('git', command, { encoding: 'utf8' }).trimEnd();
}

export function assertDeliverableGlb(summary: GlbSummary): void {
  if (summary.meshNodesTotal <= 0) throw new Error('GLB must contain at least one mesh node');
  if (!summary.worldBbox) throw new Error('GLB must have a world bbox');
  if (![...summary.worldBbox.min, ...summary.worldBbox.max, ...summary.worldBbox.size].every(Number.isFinite)) {
    throw new Error('GLB world bbox is not finite');
  }
}

export function deepEqualJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
