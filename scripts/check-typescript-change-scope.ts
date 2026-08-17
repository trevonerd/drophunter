#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  computeLineStarts,
  createScanner,
  LanguageVariant,
  SyntaxKind,
} from 'typescript/unstable/ast';

const MAX_PURE_LOC = 250;
const TYPESCRIPT_EXTENSIONS = new Set(['.cts', '.mts', '.ts', '.tsx']);
const SCOPED_DIRECTORIES = ['scripts', 'src', 'tests'] as const;

type RuleId =
  | 'no-any-annotation'
  | 'no-any-assertion'
  | 'no-enum'
  | 'no-non-null-assertion'
  | 'no-ts-expect-error'
  | 'no-ts-ignore'
  | 'no-unknown-assertion';

type SourceToken = {
  readonly end: number;
  readonly kind: SyntaxKind;
  readonly start: number;
  readonly text: string;
};

type Violation = {
  readonly column: number;
  readonly filePath: string;
  readonly line: number;
  readonly message: string;
  readonly ruleId: RuleId;
};

type FileReport = {
  readonly pureLoc: number;
  readonly violations: readonly Violation[];
};

export type CommandResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

function runGit(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', '-C', root, ...args], stdout: 'pipe', stderr: 'pipe' });
  const stderr = new TextDecoder().decode(result.stderr);
  if (!result.success) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
  return new TextDecoder().decode(result.stdout);
}

function changedPaths(root: string, base: string): string[] {
  const tracked = runGit(root, ['diff', '--name-only', '-z', '--diff-filter=ACMR', base, '--', ...SCOPED_DIRECTORIES]);
  const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...SCOPED_DIRECTORIES]);
  return [...new Set(`${tracked}\0${untracked}`.split('\0'))]
    .filter((filePath) => filePath.length > 0 && TYPESCRIPT_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort();
}

function lineAndColumn(lineStarts: readonly number[], position: number): { readonly column: number; readonly line: number } {
  let low = 0;
  let high = lineStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle];
    if (lineStart !== undefined && lineStart <= position) low = middle + 1;
    else high = middle;
  }
  const lineIndex = Math.max(0, low - 1);
  const lineStart = lineStarts[lineIndex] ?? 0;
  return { line: lineIndex + 1, column: position - lineStart + 1 };
}

function scanTokens(source: string, filePath: string, skipTrivia: boolean): SourceToken[] {
  const languageVariant = path.extname(filePath).toLowerCase() === '.tsx' ? LanguageVariant.JSX : LanguageVariant.Standard;
  const scanner = createScanner(skipTrivia, languageVariant, source);
  const tokens: SourceToken[] = [];
  let templateExpressionDepth = 0;
  let kind = scanner.scan();
  while (kind !== SyntaxKind.EndOfFile) {
    tokens.push({ end: scanner.getTokenEnd(), kind, start: scanner.getTokenStart(), text: scanner.getTokenText() });
    if (kind === SyntaxKind.TemplateHead || kind === SyntaxKind.TemplateMiddle) templateExpressionDepth = 1;
    if (templateExpressionDepth > 0 && kind === SyntaxKind.OpenBraceToken) templateExpressionDepth += 1;
    if (templateExpressionDepth > 0 && kind === SyntaxKind.CloseBraceToken) {
      templateExpressionDepth -= 1;
      if (templateExpressionDepth === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === SyntaxKind.TemplateMiddle) templateExpressionDepth = 1;
        continue;
      }
    }
    kind = scanner.scan();
  }
  return tokens;
}

function hasExpressionEnding(kind: SyntaxKind): boolean {
  return [
    SyntaxKind.CloseBracketToken,
    SyntaxKind.CloseParenToken,
    SyntaxKind.FalseKeyword,
    SyntaxKind.Identifier,
    SyntaxKind.NumericLiteral,
    SyntaxKind.NullKeyword,
    SyntaxKind.PrivateIdentifier,
    SyntaxKind.StringLiteral,
    SyntaxKind.TrueKeyword,
  ].includes(kind);
}

function addViolation(
  violations: Violation[],
  lineStarts: readonly number[],
  filePath: string,
  token: SourceToken,
  ruleId: RuleId,
  message: string,
): void {
  const position = lineAndColumn(lineStarts, token.start);
  violations.push({ ...position, filePath, line: position.line, message, ruleId });
}

function scanComments(source: string, filePath: string, lineStarts: readonly number[], violations: Violation[]): void {
  for (const token of scanTokens(source, filePath, false)) {
    if (token.kind !== SyntaxKind.SingleLineCommentTrivia && token.kind !== SyntaxKind.MultiLineCommentTrivia) continue;
    const ruleId = token.text.includes('@ts-expect-error') ? 'no-ts-expect-error' : token.text.includes('@ts-ignore') ? 'no-ts-ignore' : null;
    if (ruleId !== null) {
      addViolation(violations, lineStarts, filePath, token, ruleId, `\`@ts-${ruleId === 'no-ts-ignore' ? 'ignore' : 'expect-error'}\` is forbidden`);
    }
  }
}

function analyzeFile(root: string, relativePath: string): FileReport {
  const filePath = path.resolve(root, relativePath);
  const source = readFileSync(filePath, 'utf8');
  const lineStarts = computeLineStarts(source);
  const tokens = scanTokens(source, filePath, true);
  const pureLines = new Set<number>();
  const violations: Violation[] = [];
  for (const token of tokens) {
    const firstLine = lineAndColumn(lineStarts, token.start).line;
    const lastLine = lineAndColumn(lineStarts, Math.max(token.start, token.end - 1)).line;
    for (let line = firstLine; line <= lastLine; line += 1) pureLines.add(line);
  }
  for (const [index, token] of tokens.entries()) {
    const previous = tokens[index - 1];
    if (token.kind === SyntaxKind.AsKeyword && tokens[index + 1]?.kind === SyntaxKind.AnyKeyword) {
      addViolation(violations, lineStarts, relativePath, tokens[index + 1] ?? token, 'no-any-assertion', '`as any` is forbidden');
    }
    if (token.kind === SyntaxKind.AsKeyword && tokens[index + 1]?.kind === SyntaxKind.UnknownKeyword) {
      addViolation(violations, lineStarts, relativePath, tokens[index + 1] ?? token, 'no-unknown-assertion', '`as unknown` is forbidden');
    }
    if (token.kind === SyntaxKind.AnyKeyword && previous?.kind !== SyntaxKind.AsKeyword) {
      addViolation(violations, lineStarts, relativePath, token, 'no-any-annotation', 'explicit `any` is forbidden');
    }
    if (token.kind === SyntaxKind.EnumKeyword) {
      addViolation(violations, lineStarts, relativePath, token, 'no-enum', '`enum` is forbidden; use a literal union');
    }
    if (token.kind === SyntaxKind.ExclamationToken && previous !== undefined && hasExpressionEnding(previous.kind)) {
      addViolation(violations, lineStarts, relativePath, token, 'no-non-null-assertion', 'non-null assertion is forbidden');
    }
  }
  scanComments(source, relativePath, lineStarts, violations);
  return { pureLoc: pureLines.size, violations };
}

function formatViolation(violation: Violation): string {
  return `${violation.filePath}:${violation.line}:${violation.column}: [${violation.ruleId}] ${violation.message}`;
}

function parseBase(args: readonly string[]): string {
  const baseIndex = args.indexOf('--base');
  return baseIndex >= 0 ? args[baseIndex + 1] ?? 'HEAD' : 'HEAD';
}

export function runCheckerAt(root: string, base: string): CommandResult {
  const files = changedPaths(root, base);
  const reports = files.map((filePath) => ({ filePath, report: analyzeFile(root, filePath) }));
  const output = reports.map(({ filePath, report }) => `${filePath}: ${report.pureLoc} pure LOC`).join('\n');
  const violations = reports.flatMap(({ report }) => report.violations);
  const stderr = [
    ...reports.flatMap(({ filePath, report }) => report.pureLoc > MAX_PURE_LOC ? [`${filePath}: ${report.pureLoc} pure LOC exceeds ${MAX_PURE_LOC}`] : []),
    ...violations.map(formatViolation),
  ].join('\n');
  const tooLarge = reports.some(({ report }) => report.pureLoc > MAX_PURE_LOC);
  return {
    exitCode: tooLarge || violations.length > 0 ? 1 : 0,
    stderr,
    stdout: `${output}${output.length > 0 ? '\n' : ''}Scanned ${files.length} TypeScript file(s).`,
  };
}

function runChecker(args: readonly string[]): CommandResult {
  return runCheckerAt(process.cwd(), parseBase(args));
}

function main(): void {
  try {
    const result = runChecker(process.argv.slice(2));
    if (result.stdout.length > 0) console.log(result.stdout);
    if (result.stderr.length > 0) console.error(result.stderr);
    process.exitCode = result.exitCode;
  } catch (error) {
    if (error instanceof Error) console.error(error.message);
    else console.error('TypeScript scope checker failed');
    process.exitCode = 2;
  }
}

if (import.meta.main) main();
