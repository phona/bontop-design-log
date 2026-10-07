import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { ModelPackageLinksSchema, type ModelPackageLinks, type ModelPackageScopeRef } from '../shared/model-package-links.js';

export const MODEL_PACKAGE_LINKS_PATH = 'config/model-package-links.yaml';

function containsId(value: unknown, id: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsId(item, id));
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.id === id) return true;
  return Object.values(record).some((item) => containsId(item, id));
}

function containsFieldValue(value: unknown, field: string, expected: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsFieldValue(item, field, expected));
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record[field] === expected) return true;
  return Object.values(record).some((item) => containsFieldValue(item, field, expected));
}

function containsKey(value: unknown, expected: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, expected));
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Object.hasOwn(record, expected) || Object.values(record).some((item) => containsKey(item, expected));
}

/**
 * Load the internal package-to-model crosswalk and verify each budget reference.
 * Amounts and component descriptions stay in the referenced phase control files.
 */
export function loadModelPackageLinks(path = MODEL_PACKAGE_LINKS_PATH): ModelPackageLinks {
  let parsed: ModelPackageLinks;
  try {
    const raw = parseYaml(readFileSync(path, 'utf8'));
    parsed = ModelPackageLinksSchema.parse(raw);
  } catch (err) {
    throw new Error(`invalid model-package links ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const authorityDocs = new Map<string, unknown>();
  const getAuthority = (key: string): unknown => {
    const authorityPath = parsed.authorities[key];
    if (!authorityPath) throw new Error(`${path}: unknown authority "${key}"`);
    if (!authorityDocs.has(key)) {
      try {
        authorityDocs.set(key, parseYaml(readFileSync(authorityPath, 'utf8')));
      } catch (err) {
        throw new Error(`${path}: cannot read authority ${key} (${authorityPath}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return authorityDocs.get(key);
  };

  const assertSelector = (source: string, selector: ModelPackageScopeRef['select'], linkId: string): void => {
    const doc = getAuthority(source);
    const exists = (field: string, value: string): boolean => {
      switch (field) {
        case 'ids':
        case 'plan_ids': return containsId(doc, value);
        case 'room_ids': return containsFieldValue(doc, 'room', value) || containsKey(doc, value) || containsId(doc, value);
        case 'types': return containsFieldValue(doc, 'type', value);
        case 'layers': return containsFieldValue(doc, 'layer', value);
        case 'trade': return containsFieldValue(doc, 'trade', value);
        case 'collections': return containsKey(doc, value);
        default: return true;
      }
    };
    for (const field of ['ids', 'plan_ids', 'room_ids', 'types', 'layers', 'trade', 'collections'] as const) {
      for (const value of selector[field] ?? []) {
        if (!exists(field, value)) throw new Error(`${path}: ${linkId} selector ${source}.${field} references unknown "${value}"`);
      }
    }
  };

  const linkIds = new Set<string>();
  const budgetRefs = new Set<string>();
  for (const link of parsed.links) {
    if (linkIds.has(link.id)) throw new Error(`${path}: duplicate link id ${link.id}`);
    linkIds.add(link.id);
    for (const ref of link.scope ?? []) assertSelector(ref.source, ref.select, link.id);
    const budgetAuthority = getAuthority(link.budget_ref.source) as { phase_id?: unknown } | null;
    if (!budgetAuthority || budgetAuthority.phase_id !== link.phase_id) {
      throw new Error(`${path}: ${link.id} phase_id does not match authority ${link.budget_ref.source}`);
    }
    if (!containsId(budgetAuthority, link.budget_ref.id)) {
      throw new Error(`${path}: ${link.id} references unknown budget id ${link.budget_ref.id} in ${link.budget_ref.source}`);
    }
    const budgetRefKey = `${link.phase_id}:${link.budget_ref.source}:${link.budget_ref.id}`;
    if (budgetRefs.has(budgetRefKey)) throw new Error(`${path}: duplicate budget link ${budgetRefKey}`);
    budgetRefs.add(budgetRefKey);
  }

  return parsed;
}
