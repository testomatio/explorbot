import dedent from 'dedent';

export const bareHelp = dedent(`
  Declarative browser testing on top of playwright-cli

    prima browser start <url>                       open browser (playwright-cli), print AI model
    prima go "<page>"                               navigate: url, path or page name
    prima do "<step>" "<step>" ...                  act on the page
    prima check "<outcome>" --expected "<result>"   act, then judge the result
    prima ux [focus]                                UX review
    prima video --purpose "<name>"                  join the recordings of that purpose
    prima browser stop                              close browser

    do/check options:
      --purpose "<name>"   group commands into one session, report and video
      --video              record the command; needs --purpose and ffmpeg

    prima state                    page as it is: overlay, aria, html, screenshot (no AI)
    prima verify "<statement>"     assert a statement, no actions
    prima ask "<question>"         answer a question about the page
    prima research                 map the page into locators
    prima pw "<fn>"                run a Playwright function (no AI)

    prima skill              usage guide for coding agents
    prima skill --install    install it: local (default) or global
    prima --help             all commands and options
`);

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
