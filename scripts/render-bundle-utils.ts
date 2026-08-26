import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { GlbSummary } from './inspect-glb.js';
import { curtainProjectionSnapshotSha256, expectedVisibleCurtainNodes } from '../shared/curtain-projection.js';
import type { CurtainRenderProjection, CurtainState, ProjectRenderFactsProjection } from '../shared/types.js';

export const RENDER_BUNDLE_SCHEMA_VERSION = '2.0';

export interface CurtainPresentationSummary {
  snapshotSha256: string;
  effectiveByRoom: Record<string, CurtainState>;
  expectedNodeIds: string[];
  actualNodeIds: string[];
}

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
  curtainPresentation: CurtainPresentationSummary;
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

export function expectedCurtainNodeIds(projection: CurtainRenderProjection): string[] {
  return projection.curtains.flatMap((curtain) => curtain.expectedVisibleNodes).sort();
}

const CURTAIN_NODE_RE = /^([^:]+):(sheer|blackout|blinds):(deployed|gathered)(?::(left|right))?$/u;

function assertProjectionSelfConsistent(projection: CurtainRenderProjection): void {
  if (curtainProjectionSnapshotSha256(projection) !== projection.snapshotSha256) throw new Error('Curtain projection snapshotSha256 does not match its semantic content');
  for (const curtain of projection.curtains) {
    const derived = expectedVisibleCurtainNodes(curtain.id, curtain.kind, curtain.state);
    if (JSON.stringify(derived) !== JSON.stringify(curtain.expectedVisibleNodes)) {
      throw new Error(`Curtain projection expectedVisibleNodes drift for ${curtain.id}`);
    }
  }
}

/**
 * 交叉验证 GLB 实际窗帘节点与 facts projection 的期望节点。
 * 拒绝 missing / unexpected / duplicate / unknown 窗帘节点；
 * 通过时返回写入 manifest 的 curtainPresentation 摘要。
 */
export function assertCurtainNodesConsistent(summary: GlbSummary, projection: CurtainRenderProjection): CurtainPresentationSummary {
  assertProjectionSelfConsistent(projection);
  const expected = expectedCurtainNodeIds(projection);
  const knownCurtainIds = new Set(projection.curtains.map((curtain) => curtain.id));

  const actual: string[] = [];
  const unknown: string[] = [];
  for (const name of summary.nodeIds) {
    const match = CURTAIN_NODE_RE.exec(name);
    if (!match) {
      if (/^[^:]+:(sheer|blackout|blinds):/u.test(name)) unknown.push(name);
      continue;
    }
    const [, curtainId, layer, variant, segment] = match;
    const malformed = variant === 'deployed' && segment !== undefined
      || layer === 'blinds' && variant === 'gathered' && segment !== undefined
      || layer !== 'blinds' && variant === 'gathered' && segment === undefined;
    if (malformed || !knownCurtainIds.has(curtainId)) unknown.push(name);
    else actual.push(name);
  }
  if (unknown.length > 0) throw new Error(`GLB contains unknown curtain nodes: ${unknown.join(', ')}`);

  const duplicates = summary.duplicateNodeIds.filter((id) => knownCurtainIds.has(id.split(':')[0]));
  if (duplicates.length > 0) throw new Error(`GLB contains duplicate curtain nodes: ${duplicates.join(', ')}`);

  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((id) => !actualSet.has(id));
  if (missing.length > 0) throw new Error(`GLB is missing expected curtain nodes: ${missing.join(', ')}`);
  const unexpected = actual.filter((id) => !expectedSet.has(id));
  if (unexpected.length > 0) throw new Error(`GLB contains unexpected curtain nodes: ${unexpected.join(', ')}`);

  return {
    snapshotSha256: projection.snapshotSha256,
    effectiveByRoom: { ...projection.effectiveByRoom },
    expectedNodeIds: expected,
    actualNodeIds: [...actual].sort(),
  };
}

export function deepEqualJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
