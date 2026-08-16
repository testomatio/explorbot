# Prima boat vs playwright-cli — field review

**Date:** 2026-08-06
**Target:** Testeiya Agent (`localhost:3050`) — sidebar Workflows section + Skill editor
**Setup:** global config (`~/.explorbot/config.js`), no project config
**Models:** `groq/openai/gpt-oss-20b` (model), `openrouter/gpt-5.6-luna` (vision + agentic)
**Comparator:** `@playwright/cli` 0.1.13
**Method:** drive the feature with prima, fall back to playwright-cli whenever prima stalled

---

## Verdict up front

Prima is not a replacement for playwright-cli today. It is a strong *complement*: two of its
commands (`verify`, `ask`) do work playwright-cli cannot do at all, and four defects stop it
from owning the driving loop. Recommended split as it stands:

- **playwright-cli** — attach, navigate, read page state, drive verified locators.
- **prima** — `verify` for assertions, `ask` for visual judgement, `--no-heal` for a failure
  report you can retarget from.

---

## The feature under test — it works

Everything the sidebar Workflow and Skill editor promises checked out.

**Workflows section**

- The rail button opens a Workflows panel with five categories: Analysis & Planning,
  Test Design & Management, Test Execution & Automation, Reporting/CI-CD & Quality Gates,
  Metrics/Release & Analytics.
- Accordion is single-open; the first category is expanded by default and lists its four
  prompts (Review requirements, Risk-based focus, Analyze PR requirements, Analyze PR diff).
- "Workflow overview" opens the diagram dialog. Vision check and my own screenshot agree:
  a clean left-to-right five-stage pipeline, arrows between stages, nothing clipped or
  overlapping.

**Skill editor**

- Skills popover lists 42 skills with category filter chips.
- Row actions menu offers "Change skill globally", "Edit for this project", "Disable".
- The editor opens with the skill markdown loaded, Save disabled.
- Typing flips the header to `● unsaved` and enables Save.
- "Close editor" discards: no file appeared under `~/.testeiya/skills/`, and the agent
  repo's `git status` stayed clean.

One cosmetic thing worth a look: the filter chips include single-item categories named
after the skill itself — "Playwright Best Practices Skill 1", "Playwright Cli 1" — next to
real groupings like "Test Management 12". Category derivation looks like it falls back to
the skill name when a skill has no category.

---

## Where prima was better

**1. `verify` — the standout.** One command turns a sentence into a pass/fail *and* the
assertion code that proved it.

```
prima verify "the sidebar Workflows section lists five workflow categories, and the
              Analysis & Planning category is expanded showing individual workflow prompts"
→ 14.8s, passed: true
  I.seeElement({"role":"button","text":"Analysis & Planning"});
  ... all five categories ...
  I.see('Review requirements', '#base-ui-_r_2al_');  ... all four prompts ...
```

With playwright-cli the same check is snapshot → read the tree myself → write five
assertions by hand. Prima did it in one call, and the output is reusable test material.
This is the command that justifies the boat.

**2. `ask` — visual judgement with no image in my context.**

```
prima ask "Is the workflow diagram laid out as a readable left-to-right pipeline,
           or is anything visually broken, overlapping or cut off?"
→ 8.7s, correct answer
```

I checked it against the PNG afterwards and it was right. playwright-cli can only hand me
a file; *I* have to look at it, and the image lands in my context permanently.

**3. Descriptions outlive refs.** playwright-cli refs (`e13`, `e26`, `e647`) are snapshot-scoped.
This app re-renders constantly, so every interaction meant re-snapshotting for fresh refs —
8k bytes each time. `prima click "the Workflows button in the left vertical sidebar rail"`
needs no prior read at all.

**4. Artifacts stay on disk.** Every envelope wrote `aria.yml` / `page.html` and cited absolute
paths. `page.html` was 376K and never entered my context. That is the design goal, delivered.

**5. The `--no-heal` failure envelope is exactly right.**

```
prima pw '({page}) => page.click("[data-test=nonexistent-thing]", {timeout:3000})' --no-heal
→ 8.6s, ok: false
  error: page.click: Timeout 3000ms exceeded. Call log: waiting for locator(...)
  ### Current page (compact ARIA)  ← enough to retarget, without the full tree
```

Error plus a compact ARIA snapshot in one response is better than what playwright-cli gives
on a failed click, which is the error alone.

---

## Where playwright-cli was better

**1. Speed — one to two orders of magnitude.** `snapshot` returned in **0.2–0.3s**. Prima's
cheapest command was 6.1s; the median was ~12s; `go` took **3m00s** and one owned-browser
`verify` took **2m32s**. Across ~17 prima commands I spent roughly ten minutes waiting.

**2. It does exactly what you asked — nothing else.** `prima do` given two instructions
("close the dialog", "open the Skills menu") performed both and then kept going: searched the
skill list for "playwright-cli" and inserted the skill, leaving `/playwright-cli` typed into a
live chat box. Two instructions in, four actions out, `ok: true`. Prima's `go` did the same
during recovery — it clicked "Workspace", "Show panel", pressed F5 and clicked "Cancel" while
merely trying to navigate. playwright-cli has never once done something I did not type.

**3. Attach just works.** playwright-cli opened and reattached to its own browser with no
ceremony. Prima could not attach at all without hand-patching a file (details below).

**4. `eval` reaches state prima cannot express.** The one assertion prima got wrong —
"is Save enabled now?" — was a one-liner for playwright-cli:

```
$PW eval '() => [...document.querySelectorAll("button")].filter(b=>/Save/.test(b.textContent))
                 .map(b=>({t:b.textContent.trim(), disabled:b.disabled}))'
→ [{ "t": "saveSave", "disabled": false }]
```

playwright-cli's snapshot also carries `[disabled]`, `[pressed]`, `[active]` inline. Prima's
UI map carries none of that.

**5. Honest failures.** playwright-cli never told me an action succeeded when it hadn't.
Prima did (see #1 below).

**6. `research` costs more context than a snapshot, not less.** The one `research` call
returned ~5k tokens of UI-map markdown — versus 8,110 bytes (~2k tokens) for a full
playwright-cli snapshot of the same page. Its locators were also worse: generated Base-UI ids
(`button#base-ui-_R_qcmpbmulb_`) and positional CSS chains
(`div:nth-of-type(1) > div > div:nth-of-type(1) > div`), neither of which survives a re-render.
Prima's own compact-ARIA failure block is the cheaper, better read.

---

## Defects found in prima, worst first

**1. Heal converts a failed action into a different action and reports success.**

```
prima pw '({page}) => page.click("[data-test=nonexistent-thing]", {timeout:3000})'
→ ok: true
  healed: true (recovered after 1 attempt)
  used: // Click the "New agent" button
        I.click({ role: "button", text: "New agent" });
```

The requested element does not exist. Heal did not find another route to the same intent —
there was no such intent to reach. It picked an unrelated control, clicked it, and returned
`ok: true`. An orchestrator that trusts the envelope believes its own action landed. Heal
should only re-route toward the *same* target; when the target cannot be identified, the
correct answer is the `--no-heal` envelope.

**2. `verify` false-negatives with no diagnostic.**

```
prima verify "the Save button in the skill editor is now enabled because the skill
              content has unsaved changes"
→ passed: false
  evidence: no assertion held on the current page
  code:     (empty)
```

The app was working — `● unsaved` was displayed and Save was enabled.

The cause is the vocabulary, not the model. `rules/navigator/verification-actions.md` offers
exactly nine assertions — `see`, `seeElement`, `seeInField`, `seeInTitle`, `seeInSource` and
their `dontSee*` counterparts — none of which express enabled/disabled/checked/selected, and
the rules additionally steer away from attribute selectors (`NEVER use ':has-text(...)'`,
"never check value via CSS attribute selectors"). So a claim about interactive state is
unprovable by construction, and prima reports that as the *feature* failing rather than as a
check it could not express. Empty `code:` and a generic evidence line leave no way to tell
"the app is broken" from "I could not phrase this".

**3. Auto-discovery of a playwright-cli session cannot work; `--endpoint` needs playwright 1.62.**

> **Corrected 2026-08-07 after re-testing.** The original run was on explorbot's pinned
> playwright **1.60.0** against a 1.61.0-alpha daemon, and concluded attach was broken
> outright. That was a stale-dependency artifact. Re-tested with `playwright@1.62.1` and
> `@playwright/cli@0.1.17` (playwright 1.62.0-alpha): `chromium.connect()` succeeds with
> **our own** playwright, and `prima verify --endpoint <sock>` returns `ok: true` in 16.6s.
> Upgrading the pin fixes the connect half. What remains is discovery.

- **Version skew (fixed by upgrading).** `playwright@^1.60` could not `connect()` to a
  1.61/1.62 browser server — it timed out. `playwright@1.62.1` connects to both its own
  minor and the 1.62.0-alpha daemon. The pin should move to `^1.62`.
- **Missing `workspaceDir` (still broken).** No `@playwright/cli` release writes a
  `workspaceDir` field into `~/.cache/ms-playwright/b/browser@<guid>` — verified on 0.1.13
  and 0.1.17. `parseDescriptor` (`boat/prima/src/pw-registry.ts:56`) requires it, so every
  descriptor is dropped, `selectDescriptor` filters on a field that never exists, and
  auto-discovery finds nothing no matter what version is installed. Prima cannot attach
  without `--endpoint` unless it stops keying on `workspaceDir`.
- **The failure message sends you in a circle.** With a session open, discovery fails with
  "No browser to drive... Open one first: `playwright-cli open <url>`" — advising exactly
  what the user already did. `prima browser list` likewise reports "no browser instances
  running" while a session is live.

**4. A redirect that appends query params is treated as failed navigation.** The app sends
`/` → `/?session=<uuid>&ws=1`. `prima go http://localhost:3050` burned **3 minutes** and eight
attempts before healing; against prima's own browser the same navigation ended in a hard tool
error after **2m32s** —

```
error: tool: Navigation to / failed: redirected to /?session=...&ws=1 and could not resolve
```

— in an envelope whose own inlined ARIA proves the page had loaded correctly. Session-param
redirects are common enough that this alone blocks unattended use.

### Smaller issues

- **`used:` is often not runnable.** `click` concatenated all five ladder attempts, including
  invalid JS: `I.click(".sidebar button:has-text("Workflows")")`. `do` emitted a
  `// 1. Open dialog...` comment line inside the code. The spec promises "the exact code that
  worked" — it should be the winning line only.
- **`### Changes` / ariaDiff never appeared** in any successful envelope. That block is the
  envelope's core evidence promise; without it, a successful `click` proves nothing and I had
  to spend a playwright-cli snapshot to confirm every action.
- **`network.jsonl` is advertised in every envelope and was 0 bytes in all 18 runs.**
- **`click` reports itself as `do`.** Every `click` envelope printed `command: do "..."`.
- **Every command requires a URL** even when attached to a browser already sitting on the page,
  and even when the site is registered. `EXPLORBOT_URL` satisfies config loading but not page
  opening on an empty owned browser, which needs `--url` as well.
- **Prima pollutes a shared browser.** After `research`, the visual-annotation overlays
  (`Legend`, `e8`, `e10`, …) were still in the live DOM and showed up in the next
  playwright-cli snapshot.

### Environment friction (not prima's design)

- **`node_modules` is a committed, self-referential symlink.** `git ls-files -s node_modules`
  shows mode `120000` pointing at `/home/davert/projects/explorbot/node_modules` — itself.
  It was added in `7cc52eb` ("Let EXPLORBOT_* variables win over the global config"). Being
  tracked, it overrides the `node_modules/` line in `.gitignore`. Every Node resolution fails
  with `ELOOP` / "Too many levels of symbolic links", so `npx tsc`, the build, and the CLI are
  all dead on a fresh checkout of this branch. Removing it and running `bun install` fixes it.
- `bun run build:npm` fails with `env: unknown error: execvp failed`; `bash scripts/build-npm.sh`
  works.
- The `prima` bin is not exposed by the existing global npm link — `explorbot prima ...` only.
- Prima needs the Node build for browser-server endpoints, so `dist/` must exist before any of
  this runs.

---

## What would make prima a replacement

In priority order:

1. Heal must never substitute a different target; unresolvable intent → failure envelope.
2. `verify` must distinguish "assertion failed" from "cannot express this assertion", and
   `rules/navigator/verification-actions.md` needs state assertions
   (enabled/disabled/checked/selected) alongside the nine text/presence ones it has now.
3. Treat a redirect that preserves origin and path as navigation success.
4. Move the playwright pin to `^1.62` (fixes `--endpoint`), and stop keying discovery on
   `workspaceDir` — no `@playwright/cli` release emits it.
5. Emit `### Changes` on every action, and reduce `used:` to the winning line.

With 1–3 fixed, prima could own the assertion and inspection half of a session outright.
Driving would still belong to playwright-cli until the per-command latency comes down.
