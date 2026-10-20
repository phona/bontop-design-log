import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markdownDestinations,
  markdownPathCandidates,
  movedArchiveIteration,
  targetExists,
} from '../../scripts/verify/documents/document-reference-utils.js';

test('markdown link parser returns inline links and reference definitions', () => {
  const text = [
    '[decision](../decisions/05-hvac.md)',
    '![plan](<evidence/plan image.png>)',
    '[config]: config/hvac.yaml',
    '[external](https://example.com/spec)',
  ].join('\n');
  assert.deepEqual(markdownDestinations(text), [
    '../decisions/05-hvac.md',
    'evidence/plan image.png',
    'https://example.com/spec',
    'config/hvac.yaml',
  ]);
});

test('markdown links resolve from the source document while repo-root paths stay rooted', () => {
  const root = '/repo';
  assert.deepEqual(markdownPathCandidates(root, 'docs/hvac/audit.md', '../decisions/05-hvac.md'), [
    '/repo/docs/decisions/05-hvac.md',
  ]);
  assert.deepEqual(markdownPathCandidates(root, 'docs/hvac/audit.md', 'config/hvac.yaml'), [
    '/repo/config/hvac.yaml',
  ]);
  assert.equal(targetExists(['/repo/docs/decisions/05-hvac.md'], (candidate) => candidate.endsWith('05-hvac.md')), true);
});

test('archive relocation check only flags paths still using the old active root', () => {
  const dirs = new Set(['docs/design-iterations/archive/round-a']);
  const exists = (relativePath: string) => dirs.has(relativePath);
  assert.equal(movedArchiveIteration('docs/design-iterations/round-a/evidence/view.png', exists), 'round-a');
  assert.equal(movedArchiveIteration('docs/design-iterations/archive/round-a/evidence/view.png', exists), undefined);
  assert.equal(movedArchiveIteration('docs/design-iterations/round-b/evidence/view.png', exists), undefined);
});
