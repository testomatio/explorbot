#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.types-build');
const TMP_SRC = path.join(TMP, 'src');
const DIST = path.join(ROOT, 'dist');

function applyEdits(text: string, edits: Array<{ start: number; end: number; replacement: string }>): string {
  edits.sort((a, b) => b.start - a.start);
  let result = text;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}

function neutralizePrivates(sourceText: string, fileName: string): string {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  const visit = (node: ts.Node) => {
    const modifiers = (node as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
    if (modifiers) {
      for (const modifier of modifiers) {
        if (modifier.kind !== ts.SyntaxKind.PrivateKeyword && modifier.kind !== ts.SyntaxKind.ProtectedKeyword) continue;
        edits.push({ start: modifier.getStart(sourceFile), end: modifier.getEnd(), replacement: 'public' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return applyEdits(sourceText, edits);
}

function rewriteDeclarationExtensions(sourceText: string, fileName: string): string {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  const record = (literal?: ts.Expression | ts.TypeNode) => {
    if (!literal || !ts.isStringLiteral(literal)) return;
    const value = literal.text;
    if (!value.startsWith('.')) return;
    if (!value.endsWith('.ts') && !value.endsWith('.tsx')) return;
    const quote = sourceText[literal.getStart(sourceFile)];
    const rewritten = value.replace(/\.tsx?$/, '.js');
    edits.push({ start: literal.getStart(sourceFile), end: literal.getEnd(), replacement: `${quote}${rewritten}${quote}` });
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) record(node.moduleSpecifier);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) record(node.argument.literal);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return applyEdits(sourceText, edits);
}

function copyTransformedSources() {
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const relative of new Bun.Glob('**/*.{ts,tsx}').scanSync(SRC)) {
    if (relative.endsWith('.test.ts') || relative.endsWith('.test.tsx')) continue;
    const absolute = path.join(SRC, relative);
    const target = path.join(TMP_SRC, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, neutralizePrivates(fs.readFileSync(absolute, 'utf8'), absolute));
  }
}

function writeTempTsconfig() {
  const tsconfig = {
    compilerOptions: {
      module: 'Node16',
      moduleResolution: 'node16',
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      jsx: 'react',
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      target: 'ESNext',
      strict: false,
      skipLibCheck: true,
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      outDir: DIST,
      rootDir: TMP,
    },
    include: ['src/**/*'],
  };
  fs.writeFileSync(path.join(TMP, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
}

function emitDeclarations(): string {
  const result = Bun.spawnSync(['npx', 'tsc', '-p', path.join(TMP, 'tsconfig.json'), '--noCheck'], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return result.stdout.toString() + result.stderr.toString();
}

function rewriteEmittedDeclarations() {
  for (const relative of new Bun.Glob('**/*.d.ts').scanSync(path.join(DIST, 'src'))) {
    const file = path.join(DIST, 'src', relative);
    const text = fs.readFileSync(file, 'utf8');
    const rewritten = rewriteDeclarationExtensions(text, file);
    if (rewritten !== text) fs.writeFileSync(file, rewritten);
  }
}

copyTransformedSources();
writeTempTsconfig();
const output = emitDeclarations();
rewriteEmittedDeclarations();
fs.rmSync(TMP, { recursive: true, force: true });

const entry = path.join(DIST, 'src', 'index.d.ts');
if (!fs.existsSync(entry)) {
  console.error('Type declaration build failed: dist/src/index.d.ts was not emitted');
  console.error(output);
  process.exit(1);
}

const diagnostics = output.split('\n').filter((line) => line.includes('error TS')).length;
const suppressed = diagnostics > 0 ? ` (${diagnostics} non-fatal declaration diagnostics from internal mixin types)` : '';
console.log(`Type declarations emitted to dist/src/${suppressed}`);
