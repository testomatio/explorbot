import dedent from 'dedent';

export const bareHelp = dedent(`
  Declarative browser testing on top of playwright-cli

  A regular check, in order:
    prima browser start <url>                       open a browser through playwright-cli; prints the AI model in use
    prima go "<page>"                               navigate to a url, a path or a page named in plain words
    prima do "<step>" "<step>" ...                  act on the page
    prima check "<outcome>" --expected "<result>"   test a behaviour end to end and judge the result
    prima ux [focus]                                review the area for UX issues
    prima video --purpose "<text>"                  join the recordings of do and check into one video
    prima browser stop                              close the browser

  Looking closer at the current page:
    prima state                    capture it as it is: open overlay, aria, html, screenshot; no AI
    prima verify "<statement>"     assert one statement without acting; check acts first, verify does not
    prima ask "<question>"         answer a question
    prima research                 map it into verified locators
    prima pw "<fn>"                run a Playwright function; no AI

    prima skill              how to use prima well (for coding agents)
    prima skill --install    install that skill: local (default) or global
    prima --help             all commands and options
`);

export const skillPointer = 'How to use these well: prima skill';

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
