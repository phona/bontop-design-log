import test from 'node:test';
import assert from 'node:assert/strict';
import { findUnquotedInlineComments } from '../../scripts/verify/yaml/inline-comment-utils.js';

test('hash tokens swallowed by YAML comments are reported', () => {
  const issues = findUnquotedInlineComments([
    'material: light cabinet #c9c1b5',
    'statement: #41 pending',
    'quoted: "literal #e7e0d6"',
  ].join('\n'));
  assert.deepEqual(issues.map((issue) => issue.line), [1, 2]);
});

test('ordinary comments, status annotations, and block scalar content are allowed', () => {
  const issues = findUnquotedInlineComments([
    'status: revoked # 2026-09-02 owner rollback',
    'note: value # ordinary comment',
    'description: |',
    '  this text includes #41 and remains block scalar content',
  ].join('\n'));
  assert.deepEqual(issues, []);
});
