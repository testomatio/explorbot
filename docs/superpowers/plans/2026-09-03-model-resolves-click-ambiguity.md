# Model-Resolved Click Ambiguity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `MultipleElementsFound` a real zero-click failure that hands the model the matched elements and lets it pick one by position, instead of an internal AI call that silently retries and clicks.

**Architecture:** Delete the in-tool disambiguation retry (`disambiguateElements`) from both `click()` and `form()`. The existing failure path in `failedToolResult` already returns `multipleElementsDetected`, a numbered `elements` list, and a suggestion — that becomes the only path. Then document CodeceptJS's `step.opts({ elementIndex: N })` in the shared action rules so the model can act on that list; the sandbox already exposes `step`, so no runtime work is needed.

**Tech Stack:** Bun, TypeScript, CodeceptJS 4 (Playwright helper), Biome, `bun:test`.

**Spec:** This document — see Background. Primary evidence: Langfuse trace `5172fb3e976aa1e3889f149dd25a039b` (session `ThoughtlessActualViolet630`, 2026-09-01).

## Background

`src/ai/tools.ts` catches `MultipleElementsFound`, runs a separate AI call to choose a position, appends `step.opts({ elementIndex: N })` to the failing command, retries, and returns `success: true` — while leaving the original `MultipleElementsFound` text in `attempts`.

Both readers of that result treat it as a failure. The Tester sees the error in the result it just received; Pilot's `formatActions` (`src/ai/pilot.ts:1038`) lifts the first `attempts[].error` into its evidence line and fires its `MultipleElementsFound → xpathCheck() then precise locator` rule (`src/ai/pilot.ts:1145`). So both send another click. Every one of those calls really clicks, because the internal retry runs inside each call.

In the reference trace a `button[role="switch"]` was clicked four times in 26 seconds — twice from the Tester's own locators, twice on Pilot's advice — each call reporting `success: true, disambiguated: true` with `code` ending in `step.opts({ elementIndex: 1 })` and an ariaDiff alternating `added switch [checked]` / `removed switch [checked]`. The plan was saved with the setting off and the test reported PASS.

The disambiguator picked position 1 correctly all four times, so it was not buying accuracy — it was buying one round trip and charging a page mutation for it. After this change an ambiguous locator never mutates the page, so a wrong guess is free.

`step.opts({ elementIndex })` already works end to end and needs no implementation: `src/utils/web-sandbox.ts:9` puts `step` in the sandbox's argument names, `node_modules/codeceptjs/lib/step/record.js:14` strips a `StepConfig` from the last argument position, and `node_modules/codeceptjs/lib/helper/Playwright.js:4285` honours `elementIndex`. It is 1-based in document order, accepts negatives counting from the end, and accepts `'first'`/`'last'`. It appears in no prompt or rule today, which is why the model could only guess new locators.

## Global Constraints

- Runtime is **Bun only**. Never invoke `node`.
- Prompt text must be **general, never example-driven**: no locator, class name, or scenario taken from the reference trace may appear in any prompt, rule, or tool description. Illustrate the shape of correct usage, not the bug.
- Prompts stay **concise** — 1-3 lines per bullet, telegraph style.
- Never hardcode site-specific locators anywhere.
- Use `dedent` for multi-line prompt blocks.
- Prefer early exit over `if`/`else`. No ternaries. No `...(cond ? {k:v} : {})` spreads.
- Run `bun run format` after each code change; `bun run lint` must stay clean.
- Do **not** add or re-add the `regression` label, and do not trigger `.github/workflows/regression.yml`.
- End every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_017DuWpxPTjAacCgowWAT631`

## File Structure

| File | Responsibility after this plan |
|---|---|
| `src/ai/tools.ts` | `click()` and `form()` report ambiguity as a plain failure; keeps `extractWebElements` / `formatElementList` / `formatMatchedElements` for the element list; no longer holds an AI disambiguator |
| `src/ai/rules.ts` | `actionRule` documents `step.opts({ elementIndex })` under `### I.click`, reaching Tester, Navigator, Captain web-mode and Rerunner through the existing imports |
| `src/ai/pilot.ts` | Its `MultipleElementsFound` diagnostic line points at `elementIndex` instead of a sharper locator |
| `tests/unit/click-ambiguity.test.ts` | New. Pins zero clicks on ambiguity, and that the element list survives later fallback failures |
| `tests/unit/matched-elements.test.ts` | Unchanged. Already covers `formatMatchedElements` |
| `CHANGELOG.md` | User-facing entry |

---

### Task 1: Ambiguous click fails without clicking

**Files:**
- Modify: `src/ai/tools.ts:95-145` (the `click` tool's command loop, the disambiguation block, the failure return)
- Test: `tests/unit/click-ambiguity.test.ts` (create)

**Interfaces:**
- Consumes: `failedToolResult(action, message, data, error)` — already async, already sets `multipleElementsDetected: true` and `elements` when any text in `message` or `data.attempts[].error` contains `'multiple elements'`, using the `error` argument to build the list.
- Produces: the `click` tool result on ambiguity — `{ success: false, action: 'click', message: 'All click commands failed', attempts, suggestion, multipleElementsDetected: true, elements }`. No `disambiguated` key exists any more.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/click-ambiguity.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'bun:test';
import { createCodeceptJSTools } from '../../src/ai/tools.ts';
import { ConfigParser } from '../../src/config.ts';

function multipleElementsError(): Error {
  const element = (xpath: string, text: string) => ({
    toAbsoluteXPath: async () => xpath,
    toOuterHTML: async () => '<button role="switch" type="button"></button>',
    getText: async () => text,
  });
  return Object.assign(new Error('Multiple elements (2) found for "{role: switch}" in strict mode'), {
    name: 'MultipleElementsFound',
    webElements: [element('/html/body/div/button[1]', 'First control'), element('/html/body/div/button[2]', 'Second control')],
  });
}

function notFoundError(): Error {
  return Object.assign(new Error('element (.missing) was not found by text|CSS|XPath'), { name: 'ElementNotFound' });
}

function fakeDeps(errorFor: (command: string) => Error) {
  const state = { url: '/settings', html: '<html><body></body></html>', ariaSnapshot: '- switch', id: 'unchanged' };
  const action: any = {
    lastError: null,
    executedSteps: [],
    ran: [] as string[],
    saveScreenshot: async () => undefined,
    attempt: async (command: string) => {
      action.ran.push(command);
      action.lastError = errorFor(command);
      return false;
    },
  };
  const deps: any = {
    explorer: { action: () => action },
    stateManager: { getCurrentState: () => state },
    ai: {},
  };
  return { deps, action };
}

function fakeTask(): any {
  return { startNote: () => ({ commit: () => {}, screenshot: undefined }) };
}

describe('click on an ambiguous locator', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('clicks nothing and hands the matched elements back to the model', async () => {
    const { deps, action } = fakeDeps(() => multipleElementsError());
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click({"role":"switch"})`], explanation: 'Toggle the control' }, {} as any);

    expect(result.success).toBe(false);
    expect(action.ran).toEqual([`I.click({"role":"switch"})`]);
    expect(result.disambiguated).toBeUndefined();
    expect(result.multipleElementsDetected).toBe(true);
    expect(result.elements).toContain('Element 1:');
    expect(result.elements).toContain('Element 2:');
  });

  it('keeps the ambiguous match when a later fallback command failed differently', async () => {
    const { deps } = fakeDeps((command) => {
      if (command.includes('role')) return multipleElementsError();
      return notFoundError();
    });
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click({"role":"switch"})`, `I.click('.missing')`], explanation: 'Toggle the control' }, {} as any);

    expect(result.multipleElementsDetected).toBe(true);
    expect(result.elements).toContain('Element 2:');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/click-ambiguity.test.ts`

Expected: both tests FAIL. The first fails because `action.ran` also contains the internal `step.opts({ elementIndex: … })` retry (and `result.disambiguated` may be set). The second fails because `elements` reads `Could not fetch element details.` — `action.lastError` at return time is the not-found error, not the ambiguity error.

- [ ] **Step 3: Capture the ambiguity error in the command loop**

In `src/ai/tools.ts`, in the `click` tool, declare the holder next to `attempts` and set it inside the loop. Replace:

```ts
        const attempts: Array<{ command: string; success: boolean; error?: string }> = [];

        for (let i = 0; i < commands.length; i++) {
          const command = transformContainsCommand(commands[i]);
          const success = await action.attempt(command, explanation);

          const attempt: { command: string; success: boolean; error?: string } = { command, success };
          if (action.lastError) attempt.error = errorText(action.lastError);
          attempts.push(attempt);
```

with:

```ts
        const attempts: Array<{ command: string; success: boolean; error?: string }> = [];
        let ambiguityError: Error | null = null;

        for (let i = 0; i < commands.length; i++) {
          const command = transformContainsCommand(commands[i]);
          const success = await action.attempt(command, explanation);

          const attempt: { command: string; success: boolean; error?: string } = { command, success };
          if (action.lastError) attempt.error = errorText(action.lastError);
          attempts.push(attempt);

          if (!ambiguityError && action.lastError?.name === 'MultipleElementsFound') ambiguityError = action.lastError;
```

- [ ] **Step 4: Delete the disambiguation retry block**

Still in the `click` tool, delete this entire block (it sits between the command loop and the final `const toolResult = …`):

```ts
        let disambiguated = null;
        if (attempts.some((a) => a.error?.toLowerCase().includes(MULTIPLE_ELEMENTS_PATTERN))) {
          disambiguated = await disambiguateElements(action.lastError, explanation, ai);
        }

        if (disambiguated) {
          debugLog('Disambiguation picked element %d', disambiguated.position);
          const failedCommand = attempts.find((a) => a.error?.toLowerCase().includes(MULTIPLE_ELEMENTS_PATTERN))?.command;
          const retryCommands = [];
          if (failedCommand) {
            retryCommands.push(failedCommand.replace(/\)$/, `, step.opts({ elementIndex: ${disambiguated.position} }))`));
          }
          retryCommands.push(`I.click('${disambiguated.xpath.replace(/'/g, "\\'")}')`);

          for (const retryCmd of retryCommands) {
            if (!(await action.attempt(retryCmd, explanation))) {
              attempts.push({ command: retryCmd, success: false, error: errorText(action.lastError) });
              continue;
            }
            const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, retryCmd);
            await commitNote(activeNote, TestResult.PASSED, toolResult, action);
            return successToolResult('click', { ...toolResult, attempts, code: retryCmd, disambiguated: true }, action);
          }
        }
```

- [ ] **Step 5: Pass the ambiguity error to the failure result**

In the same tool, change the final return's `error` argument. Replace:

```ts
        return failedToolResult(
          'click',
          'All click commands failed',
          {
            ...toolResult,
            attempts,
            suggestion,
          },
          action.lastError
        );
```

with:

```ts
        return failedToolResult(
          'click',
          'All click commands failed',
          {
            ...toolResult,
            attempts,
            suggestion,
          },
          ambiguityError || action.lastError
        );
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/unit/click-ambiguity.test.ts`

Expected: 2 pass.

- [ ] **Step 7: Commit**

```bash
git add src/ai/tools.ts tests/unit/click-ambiguity.test.ts
git commit -m "Let an ambiguous click fail without clicking"
```

---

### Task 2: Remove the AI disambiguator

**Files:**
- Modify: `src/ai/tools.ts:34` (drop the now-unused `ai` binding), `src/ai/tools.ts:18` (drop the `AIProvider` import), `src/ai/tools.ts:412-422` (the `form` tool's ambiguity branch), `src/ai/tools.ts:1370-1410` (delete `disambiguateElements`)
- Test: `tests/unit/tools.test.ts`, `tests/unit/matched-elements.test.ts` (both existing, must keep passing)

**Interfaces:**
- Consumes: nothing new.
- Produces: `createCodeceptJSTools({ explorer, stateManager }: ToolDeps, task: Task)` — the `ai` member stays on the `ToolDeps` type because `createAgentTools` uses it; only this function stops destructuring it. `disambiguateElements` no longer exists. `extractWebElements`, `formatElementList`, `formatMatchedElements`, `MAX_DISAMBIGUATE_ELEMENTS`, `MAX_DISAMBIGUATE_TEXT`, `MAX_DISAMBIGUATE_HTML` and `MULTIPLE_ELEMENTS_PATTERN` all stay — they build the element list the model now reads.

- [ ] **Step 1: Simplify the form tool's failure suggestion**

In `src/ai/tools.ts`, in the `form` tool, replace:

```ts
            let formSuggestion = 'Commands after the failing one never ran. Retry only those, using click() or form().';
            if (message.toLowerCase().includes(MULTIPLE_ELEMENTS_PATTERN)) {
              const disambiguated = await disambiguateElements(action.lastError, explanation, ai);
              if (disambiguated) {
                formSuggestion = `Multiple elements matched. Add step.opts({ elementIndex: ${disambiguated.position} }) to the failing command. Fallback locator: ${disambiguated.xpath}`;
              }
            }
```

with:

```ts
            const formSuggestion = 'Commands after the failing one never ran. Retry only those, using click() or form().';
```

`failedToolResult` already receives `action.lastError` here and replaces the suggestion with the ambiguity text plus the `elements` list whenever the message is ambiguous, so nothing is lost.

- [ ] **Step 2: Delete the disambiguator function**

Delete the whole `disambiguateElements` function from `src/ai/tools.ts` — it starts with:

```ts
async function disambiguateElements(error: Error | null | undefined, explanation: string, provider: AIProvider): Promise<{ position: number; xpath: string } | null> {
```

and ends with the closing brace after its `catch` block. Do not touch `extractWebElements`, `formatElementList` or `formatMatchedElements` directly above it.

- [ ] **Step 3: Drop the now-unused bindings**

At `src/ai/tools.ts:34`, change:

```ts
export function createCodeceptJSTools({ explorer, stateManager, ai }: ToolDeps, task: Task) {
```

to:

```ts
export function createCodeceptJSTools({ explorer, stateManager }: ToolDeps, task: Task) {
```

At `src/ai/tools.ts:18`, delete the import line:

```ts
import type { AIProvider } from './provider.ts';
```

- [ ] **Step 4: Verify nothing else referenced them**

Run: `grep -rn "disambiguateElements\|AIProvider" src/ai/tools.ts`

Expected: no output.

Run: `bun run format && bun run lint`

Expected: formatting applied, `bun run lint` reports no errors.

- [ ] **Step 5: Run the surrounding suites**

Run: `bun test tests/unit/tools.test.ts tests/unit/matched-elements.test.ts tests/unit/click-ambiguity.test.ts tests/unit/click-failure-suggestion.test.ts`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/ai/tools.ts
git commit -m "Drop the AI disambiguator from the click and form tools"
```

---

### Task 3: Teach the model to pick a match by position

**Files:**
- Modify: `src/ai/rules.ts:309-338` (the `### I.click` section of `actionRule`)
- Modify: `src/ai/tools.ts:55-65` (the `click` tool's `commands` schema description) and `src/ai/tools.ts:1285-1295` (`getMultipleElementsSuggestion`)
- Modify: `src/ai/pilot.ts:1145` (the `MultipleElementsFound` diagnostic line)
- Test: `tests/unit/click-ambiguity.test.ts` (existing, from Task 1)

**Interfaces:**
- Consumes: `actionRule` and `locatorRule` are already imported by `src/ai/tester.ts:823-825`, `src/ai/navigator.ts:414`, `src/ai/captain/web-mode.ts:146-148` and `src/ai/rerunner.ts:448-450`. Editing `actionRule` reaches all four; no import changes.
- Produces: `getMultipleElementsSuggestion(): string` — same signature, new text naming `elementIndex`.

- [ ] **Step 1: Document `elementIndex` in the shared action rule**

In `src/ai/rules.ts`, inside `actionRule`'s `### I.click` section, insert after the line `If locator doesn't work, try CSS or XPath locators.`:

```
  When one locator matches several elements, select among them by position instead of inventing another locator.
  Pass step.opts({ elementIndex: N }) as the LAST argument. N is 1-based in document order; negative counts from the end, and 'first'/'last' also work.

  <example>
    I.click('Remove', step.opts({ elementIndex: 2 }));
    I.click({ role: 'switch' }, '.panel', step.opts({ elementIndex: 1 }));
  </example>
```

- [ ] **Step 2: Rewrite the ambiguity suggestion**

In `src/ai/tools.ts`, replace the body of `getMultipleElementsSuggestion`:

```ts
function getMultipleElementsSuggestion(): string {
  return dedent`
    Multiple elements matched your locator, so NOTHING was clicked and the page is unchanged.
    Read the numbered elements list and click the one you meant by its number:
    reuse the same locator with step.opts({ elementIndex: N }) as the last argument.
    If none of them is the element you want, narrow the locator with a container or its full unique text.
  `;
}
```

- [ ] **Step 3: Point the click tool's schema at the same escape hatch**

In `src/ai/tools.ts`, in the `click` tool's `commands` description, append one line after `5. I.clickXY(x, y) - coordinates fallback`:

```
          After a result reporting multiple matches, reuse that locator with step.opts({ elementIndex: N }) as the last argument.
```

- [ ] **Step 4: Update Pilot's diagnostic line**

In `src/ai/pilot.ts`, replace:

```
      - MultipleElementsFound → xpathCheck() to identify the right one, then precise locator or visualClick().
```

with:

```
      - MultipleElementsFound → nothing was clicked. Tell Tester to reuse the same locator with step.opts({ elementIndex: N }) from the numbered elements list.
```

- [ ] **Step 5: Assert the model is told how to resolve it**

In `tests/unit/click-ambiguity.test.ts`, add one assertion to the end of the first test, after `expect(result.elements).toContain('Element 2:');`:

```ts
    expect(result.suggestion).toContain('elementIndex');
```

- [ ] **Step 6: Run the tests**

Run: `bun test tests/unit/click-ambiguity.test.ts tests/unit/rules.test.ts`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/ai/rules.ts src/ai/tools.ts src/ai/pilot.ts tests/unit/click-ambiguity.test.ts
git commit -m "Tell the model to pick an ambiguous match by position"
```

---

### Task 4: Full suites, changelog, pull request

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Run the whole unit suite**

Run: `bun test tests/unit/`

Expected: all pass. Baseline before this plan was 1247 pass / 0 fail; expect that plus the two new tests, minus none.

- [ ] **Step 2: Run the integration suite**

Run: `bun test tests/integration/`

Expected: all pass. Baseline was 92 pass / 0 fail. These exercise real prompts through the aimock server, so a prompt edit that breaks a journal assertion surfaces here.

- [ ] **Step 3: Format and lint**

Run: `bun run format && bun run lint`

Expected: clean.

- [ ] **Step 4: Add the changelog entry**

Add to `CHANGELOG.md` under a `## 2026-09-03` heading with a `### Changes` section (create the date heading directly under `# Changelog` if it does not exist yet; keep one blank line between the header and the first entry, and between entries):

```markdown
- Click tool: A locator that matches several elements is now reported as a failure that clicked nothing,
  together with the numbered list of what matched. Explorbot no longer guesses which one you meant and
  clicks it — a guess used to land a real click, so a control that toggles could be switched back by a
  retry the model thought had failed. The AI now picks a match by its number instead.
```

- [ ] **Step 5: Commit and push**

```bash
git add CHANGELOG.md
git commit -m "Add changelog entry for model-resolved click ambiguity"
git push -u origin fix/model-resolves-click-ambiguity
```

- [ ] **Step 6: Open the pull request**

Open a PR against `main` titled `Let the model resolve an ambiguous click by position`. The body must state: ambiguity now clicks nothing; the disambiguating AI call is gone; `step.opts({ elementIndex })` is documented for the model; evidence is Langfuse trace `5172fb3e976aa1e3889f149dd25a039b`. End it with the 🤖 Claude Code footer and the session link. Do **not** apply the `regression` label.

- [ ] **Step 7: Close the superseded pull request**

PR #179 (`fix/click-disambiguation-not-a-failure`) implements the rejected approach — it kept the auto-retry and only made its reporting honest. Ask the user before closing it, then close with a comment naming the replacement PR.

---

## Notes for the executor

- `MULTIPLE_ELEMENTS_PATTERN` is `'multiple elements'`, matched case-insensitively against error text. Task 1 additionally matches `error.name === 'MultipleElementsFound'` to pick the right error object out of several failed attempts — the string check stays where it is for the suggestion routing, because a failure can reach `failedToolResult` with only the text and no error object.
- `formatElementList` numbers entries `Element 1:`, `Element 2:` … 1-based, which is exactly the numbering `elementIndex` expects. Do not renumber either side.
- The `MAX_DISAMBIGUATE_*` constants keep their names. They cap the list the model reads; renaming them is churn with no user-visible effect.
- Do not add a knowledge file, a locator table, or any site-specific selector. The reference trace's app has two unlabelled `button[role="switch"]` controls; that is an accessibility gap in the application under test, not something to encode here.
