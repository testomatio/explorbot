import path from 'node:path';
import dedent from 'dedent';

const NPX_HINT = 'npx adds about 5 seconds to every call. Install once with: npm install -g prima-cli, then call prima-cli directly.';

export class PrimaHelp {
  readonly name: string;

  constructor(name = PrimaHelp.invokedAs()) {
    this.name = name;
  }

  static invokedAs(argv = process.argv, env = process.env): string {
    const script = argv[1] || '';
    const bin = path.basename(script, path.extname(script));
    let name = 'prima-cli';
    if (bin === 'prima' || path.basename(env._ || '') === 'prima') name = 'prima';
    if (bin.startsWith('explorbot')) name = 'explorbot prima';
    if (env.npm_command === 'exec') return `npx ${name}`;
    if (script.split(path.sep).some((part) => part.startsWith('bunx-'))) return `bunx ${name}`;
    return name;
  }

  mainUsage(): string {
    const cli = this.name;
    return dedent(`
      Typical run: commands toward one goal share a purpose and are recorded as evidence
        ${cli} do "<step>" "<step>" --purpose "<goal>" --video
        ${cli} check "<outcome>" --expected "<result>" --purpose "<goal>" --video
        ${cli} video --purpose "<goal>"     join the recordings into one video
        ${cli} status --purpose "<goal>"    current page and every command of that goal
    `);
  }

  bare(): string {
    const cli = this.name;
    const commands = dedent(`
      ${cli} browser start <url>                       open browser (playwright-cli), print AI model
      ${cli} go "<page>"                               navigate: url, path or page name
      ${cli} do "<step>" "<step>" ...                  act on the page
      ${cli} check "<outcome>" --expected "<result>"   act, then judge the result
      ${cli} ux [focus]                                UX review
      ${cli} browser stop                              close browser

      do/check options:
        --purpose "<name>"   group commands into one session, report and video
        --video              record video; needs --purpose and ffmpeg

      ${cli} state                    page as it is: overlay, aria, html, screenshot (no AI)
      ${cli} verify "<statement>"     assert a statement, no actions
      ${cli} ask "<question>"         answer a question about the page
      ${cli} research                 map the page into locators
      ${cli} pw "<fn>"                run a Playwright function (no AI)

      ${cli} skill              usage guide for coding agents
      ${cli} skill --install    install it: local (default) or global
      ${cli} --help             all commands and options
      ${cli} <command> --help   options of one command
    `);
    const indented = [this.mainUsage(), commands].map((block) =>
      block
        .split('\n')
        .map((line) => `  ${line}`.trimEnd())
        .join('\n')
    );
    return ['Declarative browser testing on top of playwright-cli', ...indented].join('\n\n');
  }

  footer(): string {
    return `Options of one command: ${this.name} <command> --help\nUsage guide: ${this.name} skill`;
  }

  install(): string {
    return dedent(`
      Install this skill for Claude Code, Codex and OpenCode:

        ${this.name} skill --install          into this project
        ${this.name} skill --install global   into your home directory
    `);
  }
}

export function npxHint(): string {
  if (process.env.npm_command !== 'exec') return '';
  return NPX_HINT;
}
