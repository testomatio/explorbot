import dedent from 'dedent';

export const mainUsage = dedent(`
  Typical run: commands toward one goal share a purpose and are recorded as evidence
    prima do "<step>" "<step>" --purpose "<goal>" --video
    prima check "<outcome>" --expected "<result>" --purpose "<goal>" --video
    prima video --purpose "<goal>"     join the recordings into one video
    prima status --purpose "<goal>"    current page and every command of that goal
`);

const commandHelp = dedent(`
    prima browser start <url>                       open browser (playwright-cli), print AI model
    prima go "<page>"                               navigate: url, path or page name
    prima do "<step>" "<step>" ...                  act on the page
    prima check "<outcome>" --expected "<result>"   act, then judge the result
    prima ux [focus]                                UX review
    prima browser stop                              close browser

    do/check options:
      --purpose "<name>"   group commands into one session, report and video
      --video              record video; needs --purpose and ffmpeg

    prima state                    page as it is: overlay, aria, html, screenshot (no AI)
    prima verify "<statement>"     assert a statement, no actions
    prima ask "<question>"         answer a question about the page
    prima research                 map the page into locators
    prima pw "<fn>"                run a Playwright function (no AI)

    prima skill              usage guide for coding agents
    prima skill --install    install it: local (default) or global
    prima --help             all commands and options
    prima <command> --help   options of one command
`);

export const bareHelp = [
  'Declarative browser testing on top of playwright-cli',
  ...[mainUsage, commandHelp].map((block) =>
    block
      .split('\n')
      .map((line) => `  ${line}`.trimEnd())
      .join('\n')
  ),
].join('\n\n');

export const skillPointer = 'Usage guide: prima skill';

export const installHelp = dedent(`
  Install this skill for Claude Code, Codex and OpenCode:

    prima skill --install          into this project
    prima skill --install global   into your home directory
`);

const NPX_HINT = 'npx adds about 5 seconds to every call. Install once with: npm install -g prima-cli, then call prima-cli directly.';

export function npxHint(): string {
  if (process.env.npm_command !== 'exec') return '';
  return NPX_HINT;
}
