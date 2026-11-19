import path from "node:path";

import ts from "typescript";

export interface CommentLine {
  /** 1-based line of the comment's text. */
  readonly line: number;
  /** 1-based column where `text` starts. */
  readonly column: number;
  /** The line's text with the comment markers (`//`, `/*`, `*`, `*\/`) taken off its ends. */
  readonly text: string;
}

const SCRIPT_KINDS: Readonly<Record<string, ts.ScriptKind>> = {
  ".ts": ts.ScriptKind.TS,
  ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
};

/** The extensions of the files `parseSource` reads. */
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(SCRIPT_KINDS));

export function parseSource(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    SCRIPT_KINDS[path.extname(file)] ?? ts.ScriptKind.TS,
  );
}

const LEADING_MARKER = /^\s*(?:\/\/+|\/\*+|\*+(?!\/))?\s*/;
const TRAILING_MARKER = /\s*\*+\/\s*$/;

function commentRangesOf(sourceFile: ts.SourceFile): ts.CommentRange[] {
  const text = sourceFile.text;
  const ranges = new Map<number, ts.CommentRange>();
  const add = (found: readonly ts.CommentRange[] | undefined) => {
    for (const range of found ?? []) ranges.set(range.pos, range);
  };
  const visit = (node: ts.Node) => {
    // JSX text is not code: a "//" in it is text, not a comment.
    if (node.kind === ts.SyntaxKind.JsxText) return;
    add(ts.getLeadingCommentRanges(text, node.getFullStart()));
    add(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);
  return [...ranges.values()].toSorted((left, right) => left.pos - right.pos);
}

/**
 * Every line of every comment in a source file, found by TypeScript's parser, so text in
 * strings, templates, regular expressions and JSX is never mistaken for a comment.
 */
export function commentLines(sourceFile: ts.SourceFile): CommentLine[] {
  const lines: CommentLine[] = [];
  for (const range of commentRangesOf(sourceFile)) {
    let offset = range.pos;
    for (const raw of sourceFile.text.slice(range.pos, range.end).split("\n")) {
      const marker = LEADING_MARKER.exec(raw)?.[0] ?? "";
      const start = sourceFile.getLineAndCharacterOfPosition(offset + marker.length);
      lines.push({
        line: start.line + 1,
        column: start.character + 1,
        text: raw.slice(marker.length).replace(TRAILING_MARKER, ""),
      });
      offset += raw.length + 1;
    }
  }
  return lines;
}
