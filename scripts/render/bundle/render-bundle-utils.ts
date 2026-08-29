import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { FixtureRoleRecord, GlbSummary } from '../glb/inspect-glb.js';
import { curtainProjectionSnapshotSha256, expectedVisibleCurtainNodes } from '../../../shared/curtain-projection.js';
import type { CurtainRenderProjection, CurtainState, ProjectRenderFactsProjection } from '../../../shared/types.js';

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

export interface RenderInputFingerprints {
  sourceInputsSha256: string;
  resourcesSha256: string;
  artifactsSha256: string;
  bundleSha256: string;
}

export interface RenderBundleManifest {
  schemaVersion: typeof RENDER_BUNDLE_SCHEMA_VERSION;
  revision: string;
  dirty: boolean;
  dirtyPorcelain: string;
  sourceInputs: Record<string, string>;
  resources: BundleArtifact[];
  inputFingerprints: RenderInputFingerprints;
  glbExport: {
    method: 'manual_web_export' | 'cli_shared_builder';
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

export function sha256Json(value: unknown): string {
  return sha256Bytes(Buffer.from(JSON.stringify(value), 'utf8'));
}

export function renderInputFingerprints(
  sourceInputs: Record<string, string>,
  resources: BundleArtifact[],
  artifacts: Record<string, BundleArtifact>,
): RenderInputFingerprints {
  const sourceInputsSha256 = sha256Json(Object.keys(sourceInputs).sort().map((path) => [path, sourceInputs[path]]));
  // Use code-point string comparison, matching Python's sorted() in Blender.
  // localeCompare() can order non-ASCII asset paths differently across hosts.
  const resourcesSha256 = sha256Json(resources.map(({ path, bytes, sha256 }) => [path, bytes, sha256]).sort((a, b) => String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
  const artifactsSha256 = sha256Json(Object.keys(artifacts).sort().map((key) => {
    const { path, bytes, sha256 } = artifacts[key];
    return [key, path, bytes, sha256];
  }));
  const bundleSha256 = sha256Json({ sourceInputsSha256, resourcesSha256, artifactsSha256 });
  return { sourceInputsSha256, resourcesSha256, artifactsSha256, bundleSha256 };
}

/**
 * Bundle verification authenticates inputs and manifest artifacts. Render-output verification
 * separately authenticates each PNG's sidecar metadata against this fingerprint contract.
 */
export function assertRenderOutputMetadata(metadata: unknown, fingerprints: RenderInputFingerprints): void {
  if (!metadata || typeof metadata !== 'object') throw new Error('render output metadata must be an object');
  const record = metadata as { inputFingerprints?: unknown };
  if (!record.inputFingerprints || typeof record.inputFingerprints !== 'object') throw new Error('render output metadata is missing inputFingerprints');
  if (JSON.stringify(record.inputFingerprints) !== JSON.stringify(fingerprints)) throw new Error('render output metadata inputFingerprints do not match manifest');
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

function assertFixtureRoleSummary(summary: GlbSummary): void {
  if (!Array.isArray(summary.fixtureRoles) || !Array.isArray(summary.unknownFixtureRoleTags) || !Array.isArray(summary.duplicateFixtureRoleTags)) {
    throw new Error('GLB fixture role summary is malformed');
  }
  const fixtureRoles = summary.fixtureRoles;
  const unknownFixtureRoleTags = summary.unknownFixtureRoleTags;
  const duplicateFixtureRoleTags = summary.duplicateFixtureRoleTags;
  const previous = new Set<string>();
  for (const entry of fixtureRoles) {
    if (!entry || typeof entry.nodeName !== 'string' || typeof entry.part !== 'string' || typeof entry.role !== 'string' || typeof entry.prefix !== 'string' || !entry.nodeName || !entry.part || !entry.role || !entry.prefix) {
      throw new Error('GLB fixture role summary is malformed');
    }
    const key = `${entry.nodeName}\u0000${entry.part}\u0000${entry.role}`;
    if (previous.has(key)) throw new Error(`GLB contains duplicate fixture role: ${entry.nodeName}`);
    previous.add(key);
  }
  const sorted = [...fixtureRoles].sort((a, b) => a.nodeName.localeCompare(b.nodeName) || a.part.localeCompare(b.part) || a.role.localeCompare(b.role));
  if (JSON.stringify(sorted) !== JSON.stringify(fixtureRoles)) throw new Error('GLB fixture role summary is not sorted');
  for (const field of [unknownFixtureRoleTags, duplicateFixtureRoleTags]) {
    if (field.some((value) => typeof value !== 'string' || !value) || JSON.stringify([...field].sort()) !== JSON.stringify(field)) throw new Error('GLB fixture role summary is malformed or unsorted');
  }
  if (new Set(unknownFixtureRoleTags).size !== unknownFixtureRoleTags.length || new Set(duplicateFixtureRoleTags).size !== duplicateFixtureRoleTags.length) {
    throw new Error('GLB fixture role summary contains duplicate diagnostics');
  }
}

export function assertDeliverableGlb(summary: GlbSummary): void {
  assertFixtureRoleSummary(summary);
  if ((summary.unknownFixtureRoleTags ?? []).length > 0) throw new Error(`GLB contains malformed fixture role tags: ${summary.unknownFixtureRoleTags!.join(', ')}`);
  if ((summary.duplicateFixtureRoleTags ?? []).length > 0) throw new Error(`GLB contains duplicate fixture role tags: ${summary.duplicateFixtureRoleTags!.join(', ')}`);
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
