import { execSync, spawnSync } from 'node:child_process';
import ts from 'typescript';

const UNUSED_CODES = ['TS6133', 'TS6192', 'TS6196', 'TS6198', 'TS6199', 'TS6205'];
const ALL_CHECKS = ['unused', 'order', 'hoisting', 'types', 'combined-types', 'loose-functions'];
const DEFAULT_ROOTS = ['src', 'bin', 'boat'];
const MIN_LOOSE_EXPORTS = 5;
const MIN_INTERSECTION = 3;
const MIN_UNION_OBJECTS = 2;

export class StructureCheck {
  private findings: Finding[] = [];

  constructor(
    private files: string[],
    private checks: Set<string>
  ) {}

  run(): Finding[] {
    if (this.checks.has('unused')) this.checkUnused();
    for (const file of this.files) {
      const source = ts.createSourceFile(file, ts.sys.readFile(file) || '', ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      if (this.checks.has('order')) this.checkOrder(source);
      if (this.checks.has('hoisting')) this.checkHoisting(source);
      if (this.checks.has('types')) this.checkTypesAtEnd(source);
      if (this.checks.has('combined-types')) this.checkCombinedTypes(source);
      if (this.checks.has('loose-functions')) this.checkLooseFunctions(source);
    }
    return this.findings;
  }

  private checkUnused(): void {
    const tracked = new Set(this.files);
    const result = spawnSync('bunx', ['tsc', '--noEmit', '--noUnusedLocals', '--noUnusedParameters', '-p', '.'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    for (const line of result.stdout.split('\n')) {
      if (!UNUSED_CODES.some((code) => line.includes(code))) continue;
      const file = line.slice(0, line.indexOf('('));
      if (!tracked.has(file)) continue;
      const position = line.slice(line.indexOf('(') + 1, line.indexOf(')')).split(',');
      this.findings.push({ check: 'unused', file, line: Number(position[0]), message: line.slice(line.indexOf(': ') + 2) });
    }
  }

  private checkOrder(source: ts.SourceFile): void {
    const statements = source.statements.filter((s) => isFunctionLike(s) || ts.isClassDeclaration(s));
    const lastExported = statements.findLastIndex((s) => isExported(s));
    for (const statement of statements.slice(0, Math.max(lastExported, 0))) {
      if (isExported(statement)) continue;
      this.add('order', source, statement, `private helper \`${nameOf(statement)}\` sits above exported code; move it below the exports`);
    }
  }

  private checkHoisting(source: ts.SourceFile): void {
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (!init || !(ts.isArrowFunction(init) || ts.isFunctionExpression(init))) continue;
        this.add('hoisting', source, statement, `\`const ${declaration.name.getText(source)} = ...\` is a function value; declare it with \`function\` so it hoists`);
      }
    }
  }

  private checkTypesAtEnd(source: ts.SourceFile): void {
    const lastCode = source.statements.findLastIndex((s) => !isTypeOnly(s) && !ts.isImportDeclaration(s) && !ts.isExportDeclaration(s));
    for (const statement of source.statements.slice(0, Math.max(lastCode, 0))) {
      if (!isTypeOnly(statement)) continue;
      this.add('types', source, statement, `type \`${nameOf(statement)}\` is declared above code; types go at the end of the file`);
    }
  }

  private checkCombinedTypes(source: ts.SourceFile): void {
    const inlineObjects = new Map<string, ts.Node[]>();
    const visit = (node: ts.Node): void => {
      if (ts.isIntersectionTypeNode(node) && node.types.length >= MIN_INTERSECTION) {
        this.add('combined-types', source, node, `intersection of ${node.types.length} types`);
      }
      if (ts.isUnionTypeNode(node) && node.types.filter(ts.isTypeLiteralNode).length >= MIN_UNION_OBJECTS) {
        this.add('combined-types', source, node, 'union of object literal types; check whether a class hierarchy or one shape fits');
      }
      if (ts.isTypeLiteralNode(node) && node.members.length > 1 && !ts.isTypeAliasDeclaration(node.parent)) {
        const key = node.getText(source).replace(/\s+/g, ' ');
        inlineObjects.set(key, [...(inlineObjects.get(key) || []), node]);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const [text, nodes] of inlineObjects) {
      if (nodes.length < 2) continue;
      this.add('combined-types', source, nodes[0], `inline object type repeated ${nodes.length}x: ${text.slice(0, 80)}`);
    }
  }

  private checkLooseFunctions(source: ts.SourceFile): void {
    if (source.statements.some(ts.isClassDeclaration)) return;
    const exported = source.statements.filter((s) => isFunctionLike(s) && isExported(s));
    if (exported.length < MIN_LOOSE_EXPORTS) return;
    this.add('loose-functions', source, exported[0], `${exported.length} exported functions and no class; check whether they do the same kind of work`);
  }

  private add(check: string, source: ts.SourceFile, node: ts.Node, message: string): void {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    this.findings.push({ check, file: source.fileName, line, message });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const checkArg = args.find((a) => a.startsWith('--check='));
  const checks = new Set(checkArg ? checkArg.slice('--check='.length).split(',') : ALL_CHECKS);
  const roots = args.filter((a) => !a.startsWith('--'));
  const files = trackedSources(roots.length ? roots : DEFAULT_ROOTS);
  const findings = new StructureCheck(files, checks).run();
  for (const check of ALL_CHECKS) {
    const group = findings.filter((f) => f.check === check);
    if (!group.length) continue;
    console.log(`\n## ${check} (${group.length})`);
    for (const f of group) console.log(`${f.file}:${f.line}  ${f.message}`);
  }
  if (!findings.length) console.log('No findings.');
}

function trackedSources(roots: string[]): string[] {
  const output = execSync(`git ls-files -- ${roots.join(' ')}`, { encoding: 'utf8' });
  return output.split('\n').filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts') && !f.includes('node_modules'));
}

function isExported(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function isFunctionLike(statement: ts.Statement): boolean {
  if (ts.isFunctionDeclaration(statement)) return true;
  if (!ts.isVariableStatement(statement)) return false;
  return statement.declarationList.declarations.some((d) => d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)));
}

function isTypeOnly(statement: ts.Statement): boolean {
  return ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement);
}

function nameOf(statement: ts.Statement): string {
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations[0].name.getText();
  const named = statement as ts.DeclarationStatement;
  return named.name?.getText() || '(anonymous)';
}

interface Finding {
  check: string;
  file: string;
  line: number;
  message: string;
}
