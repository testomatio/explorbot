import { readFileSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { MdqError, type MarkdownDoc, type Selection, mdq } from './query.ts';

const EDIT_FLAGS = ['remove', 'replace', 'insertBefore', 'insertAfter', 'prepend', 'append', 'addRow', 'addItem', 'set'] as const;

export async function runMdq(argv: string[], readStdin: StdinReader): Promise<CliResult> {
  const program = new Command();
  program
    .name('mdq')
    .description('query and edit markdown')
    .argument('[selector]', 'markdown selector')
    .argument('[file]', 'file to read; stdin when omitted')
    .option('-j, --json', 'output rows as JSON')
    .option('-c, --count', 'print the number of matches')
    .option('-t, --text', 'print unwrapped text')
    .option('--frontmatter', 'print frontmatter as JSON')
    .option('-i, --in-place', 'write the result back to the file')
    .option('--remove', 'delete matched blocks')
    .option('--replace <markdown>', 'replace matched blocks')
    .option('--insert-before <markdown>', 'insert before each match')
    .option('--insert-after <markdown>', 'insert after each match')
    .option('--prepend <markdown>', 'insert at the start of each match')
    .option('--append <markdown>', 'insert at the end of each match')
    .option('--add-row <json>', 'append a table row')
    .option('--add-item <text>', 'append a list item')
    .option('--set <key=value>', 'set an entry; omit the value to delete it')
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} });

  try {
    program.parse(argv, { from: 'user' });
  } catch (error) {
    return { output: String((error as Error).message), code: 2 };
  }

  const options = program.opts();
  let [selector, file] = program.args;
  if (options.frontmatter && selector && !file) {
    file = selector;
    selector = '';
  }

  let source = '';
  if (!file) source = await readStdin();
  if (file) {
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      return { output: `Cannot read ${file}`, code: 2 };
    }
  }

  try {
    return await apply(mdq(source), selector, options, file);
  } catch (error) {
    if (error instanceof MdqError) return { output: error.message, code: 2 };
    throw error;
  }
}

async function apply(doc: MarkdownDoc, selector: string, options: Record<string, any>, file?: string): Promise<CliResult> {
  if (options.frontmatter) return { output: `${JSON.stringify(doc.frontmatter(), null, 2)}\n`, code: 0 };
  if (!selector) return { output: 'A selector is required', code: 2 };

  const chosen = EDIT_FLAGS.filter((flag) => options[flag] !== undefined);
  if (chosen.length > 1) return { output: 'Only one edit at a time', code: 2 };

  const selection = doc.query(selector);
  if (chosen.length === 0) return read(selection, options);

  if (!selection.exists()) return finish(String(doc), 1, options, file);
  return finish(String(edit(selection, chosen[0], options)), 0, options, file);
}

function read(selection: Selection, options: Record<string, any>): CliResult {
  let code = 1;
  if (selection.exists()) code = 0;
  if (options.count) return { output: `${selection.count()}\n`, code: 0 };
  if (options.json) return { output: `${JSON.stringify(selection.rows(), null, 2)}\n`, code };
  if (options.text)
    return {
      output: selection
        .nodes()
        .map((node) => node.text)
        .join('\n\n'),
      code,
    };
  return { output: selection.text(), code };
}

function edit(selection: Selection, flag: string, options: Record<string, any>): MarkdownDoc {
  if (flag === 'remove') return selection.remove();
  if (flag === 'replace') return selection.replace(options.replace);
  if (flag === 'insertBefore') return selection.insertBefore(options.insertBefore);
  if (flag === 'insertAfter') return selection.insertAfter(options.insertAfter);
  if (flag === 'prepend') return selection.prepend(options.prepend);
  if (flag === 'append') return selection.append(options.append);
  if (flag === 'addItem') return selection.addItem(options.addItem);
  if (flag === 'addRow') return selection.addRow(JSON.parse(options.addRow));
  const separator = options.set.indexOf('=');
  if (separator < 0) return selection.setEntry(options.set, null);
  return selection.setEntry(options.set.slice(0, separator), options.set.slice(separator + 1) || null);
}

function finish(output: string, code: number, options: Record<string, any>, file?: string): CliResult {
  if (!options.inPlace) return { output, code };
  if (!file) return { output: '--in-place needs a file', code: 2 };
  writeFileSync(file, output);
  return { output: '', code };
}

export type StdinReader = () => Promise<string>;

export interface CliResult {
  output: string;
  code: number;
}
