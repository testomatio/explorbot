import dedent from 'dedent';

export const bareHelp = dedent(`
  prima — declarative browser testing on top of playwright-cli

    prima check "<outcome>" --expected "<result>"   test a behaviour
    prima do "<step>" "<step>" ...                  drive the page
    prima ask | verify | research | ux | go | pw    read, assert, map, review, navigate, raw code

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
