import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import dedent from 'dedent';
import { providerKeyHelp } from '../../../src/config.ts';

const SKILL_NAME = 'prima';
const SKILL_FILE = 'SKILL.md';
const SKILL_DIRS = ['.claude/skills', '.agents/skills'];

export class PrimaSkill {
  static render(): string {
    const keys = providerKeyHelp().map((line) => `- ${line}`);
    return `${[SKILL, '', KEY_SECTION, '', ...keys].join('\n')}\n`;
  }

  static scopes(): string[] {
    return Object.keys(installRoots());
  }

  static install(scope: string, roots = installRoots()): string[] {
    const root = roots[scope];
    return SKILL_DIRS.map((dir) => {
      const file = path.join(root, dir, SKILL_NAME, SKILL_FILE);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, PrimaSkill.render(), 'utf-8');
      return file;
    });
  }
}

function installRoots(): Record<string, string> {
  return { local: process.cwd(), global: homedir() };
}

const SKILL = dedent(`
  ---
  name: ${SKILL_NAME}
  description: Use for any browser work — checking a behaviour, driving a web app, filling a form, reading a page — through prima-cli instead of driving playwright-cli step by step. Trigger on "prima", on a browser task described as behaviour, and whenever playwright-cli would otherwise be driven one click at a time.
  ---

  # Prima

  Declarative browser testing: state what must be true, prima finds the clicks.

  ## Why not drive playwright-cli yourself

  - One call runs a whole job; snapshots stay inside prima, not in your context
  - No locators to guess; page maps and recorded experience are reused
  - A verdict is settled against a screenshot and the page structure, not "the click did not throw"
  - Every command leaves aria, html and screenshot on disk; nothing to re-capture

  ## Run it

  - Call \`prima-cli\` directly; install once with \`npm install -g prima-cli\`
  - \`npx prima-cli\` works without installing, but adds about 5 seconds to every call

  ## Session

  - \`prima-cli browser start <url>\` opens it, \`prima-cli browser stop\` closes it; both hand over to playwright-cli, prima only attaches
  - \`prima-cli browser start\` on an open session reports it
  - \`--pw-session <title>\` picks one when several are open
  - Parallel jobs need one \`--instance\` each

  ## Pick the command by intent

  - Does this behaviour work? → \`check "<outcome>" --expected "<result>"\` (repeat \`--expected\`)
  - Put the app into a state → \`do "<step>" "<step>" ...\`
  - Is this true of the page now? → \`verify "<one claim>"\`
  - What does the page show? → \`ask "<question>"\`
  - What is on this page, with locators → \`research\`
  - Is this area usable? → \`ux [focus]\`
  - Get to a page → \`go <url | path | page in words>\`
  - No wording can reach it → \`pw "({ page }) => ..."\`

  ## Write declaratively

  - State the outcome, never the click path; never pass a locator to \`check\` or \`do\`
  - \`check\` judges, \`do\` acts, \`ask\` reads: a scenario that only lists or reports gives \`check\` nothing to settle
  - Give \`do\` the whole remaining sequence in one call; one step per call throws the saving away
  - One \`verify\`, one claim
  - \`check\` starts on the page already open and never reloads it
  - \`check\` and \`do\` run for minutes; do not kill and retry

  ## Read the reply

  - \`ok\` in \`### Result\` is the verdict, and the exit code follows it; do not re-check a PASSED outcome
  - \`not verified\`: never checked, not false
  - \`CONTRADICTION\`: screenshot and run log disagree and the page could not settle it; treat as an app bug, read \`### Artifacts\`
  - \`resolved:\` under an outcome: a dispute was settled, the verdict stands
  - \`??\` on a step: it ran, the run ended before confirming it
  - \`### Warning\` about the run log alone: no vision model backed the outcome
  - \`(redirected: ...)\` after \`go\`: a login wall or access rule; sign in with \`do\`, go again

  ## Before dropping to \`pw\`

  - A control's value or state → grep \`aria.yml\` from the last command
  - What a step changed → the \`N-*.diff.yaml\` that \`do\` wrote
  - A locator → \`research\`
  - Never take a \`playwright-cli snapshot\` after a prima command; it is already on disk
  - \`pw\` is for what words cannot reach: storage, computed styles, a forced reload

  ## Setup

  - A provider API key in the environment is enough; prima picks that provider's recommended models
  - No key set: see "Getting an API key" below
  - \`prima-cli recommended-models\` lists providers, their models and which keys are set
  - \`PRIMA_CLI_AI_PROVIDER\` chooses between several keys; \`PRIMA_CLI_AI_MODEL\` pins a model as provider/model-id
  - \`prima-cli config\` shows what this directory resolves to
  - \`--purpose "<goal>"\` groups commands; \`report\` and \`video\` build from it
`);

const KEY_SECTION = dedent(`
  ## Getting an API key

  When a command reports that no AI model is usable, ask the user which provider they use and give them its line. One key is enough.
`);
