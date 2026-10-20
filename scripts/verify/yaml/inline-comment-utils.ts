export interface InlineCommentIssue {
  line: number;
  key?: string;
  comment: string;
  prefix: string;
}

function indentation(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function commentIndex(line: string): number {
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote === "'") {
      if (char === "'" && line[i + 1] === "'") { i += 1; continue; }
      if (char === "'") quote = undefined;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') { i += 1; continue; }
      if (char === '"') quote = undefined;
      continue;
    }
    if ((char === "'" || char === '"') && (i === 0 || line[i - 1] !== '\\')) { quote = char; continue; }
    if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return i;
  }
  return -1;
}

function blockScalarHeader(prefix: string): boolean {
  const trimmed = prefix.trim();
  return /:\s*[|>][+-]?\d*\s*$/.test(trimmed) || /^-\s*[|>][+-]?\d*\s*$/.test(trimmed);
}

function explicitStatusComment(prefix: string): boolean {
  const match = prefix.trim().match(/^(?:-\s*)?status\s*:\s*([A-Za-z][A-Za-z0-9_-]*)$/);
  return Boolean(match);
}

export function findUnquotedInlineComments(source: string): InlineCommentIssue[] {
  const issues: InlineCommentIssue[] = [];
  const lines = source.split(/\r?\n/);
  let blockScalarIndent: number | undefined;

  lines.forEach((line, index) => {
    const indent = indentation(line);
    if (blockScalarIndent !== undefined) {
      if (line.trim() === '' || indent > blockScalarIndent) return;
      blockScalarIndent = undefined;
    }

    const hash = commentIndex(line);
    if (hash < 0) {
      if (blockScalarHeader(line)) blockScalarIndent = indent;
      return;
    }

    const prefix = line.slice(0, hash);
    const trimmedPrefix = prefix.trim();
    if (trimmedPrefix === '' || trimmedPrefix === '-') return; // Standalone YAML comment.
    const keyMatch = trimmedPrefix.match(/^(?:-\s*)?([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
    const comment = line.slice(hash + 1);
    // Normal prose comments begin with whitespace (# comment). A bare token after #
    // is the high-risk shape that swallowed values such as `#41` and `#c9c1b5`.
    // Ordinary comments remain untouched. This check catches ambiguous bare tokens only.
    if (!/^\s/.test(comment) && !explicitStatusComment(prefix)) {
      issues.push({ line: index + 1, key: keyMatch?.[1], comment: line.slice(hash + 1).trim(), prefix: trimmedPrefix });
    }
    if (blockScalarHeader(prefix)) blockScalarIndent = indent;
  });

  return issues;
}
