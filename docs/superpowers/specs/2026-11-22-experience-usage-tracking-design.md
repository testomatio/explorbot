# Experience usage tracking

Experience files keep growing: every recorded FLOW/ACTION stays forever, and agents cannot tell a
recipe that worked yesterday from one recorded months ago against a UI that has since changed.

This change gives every record an `added` and a `used` timestamp, shows agents how long ago each record
last worked, and lets ExperienceCompactor forget records that were never used.

## Record

A record is one `## FLOW:` or `## ACTION:` h2 section of `experience/<stateHash>.md`. Usage metadata
lives inside the record, as HTML comments directly under its heading:

```markdown
## ACTION: open the user menu

<!-- added: 2026-11-02T09:14:00.000Z -->

<!-- used: 2026-11-20T16:40:00.000Z -->

```js
I.click('User menu')
```
```

- `added` — when the record was written. Set once, never changed.
- `used` — the last day the record was used. Absent until the first use.
- Values are ISO timestamps (UTC). Days are compared as UTC calendar dates.
- Comments are read and written through `mdq().comment()`.
- The blank line between the two comments is what mdq writes when it inserts a block; both forms parse.

The comments are a closed vocabulary read deterministically by code, scoped to one record, optional
(files on disk without them stay valid), and written by one module — ExperienceTracker. They are part
of the experience body grammar, not new block types: FLOW/ACTION bodies stay as they are.

## Writing `added`

`ExperienceTracker.writeExperienceFile()` is the single write path for experience bodies. Before
writing, it stamps `<!-- added: now -->` under every FLOW/ACTION heading that has no `added` comment.

That covers every writer without each one knowing the format:

- `writeAction()` / `writeFlow()` — new records get stamped.
- ExperienceCompactor rewrites: merges, URL generalization and AI review keep sections verbatim, so their
  comments survive. AI compaction rewrites sections and usually drops the comments: rewritten records get a
  fresh `added`, and when the file had used records before the rewrite, every rewritten record without
  `used` inherits the newest `used` of the old content. A used record therefore never turns into a
  never-used one through compaction. This is done in code; the compaction prompt is unchanged.
- Legacy files written before this change get stamped the first time they are written, and the
  compactor writes every file it finds unstamped (see below), so old records get a full grace period.

## Marking `used`

A record is used when it is put to work successfully. Two events count:

1. **An agent reads it.** `learnExperience` returns the section body through
   `ExperienceTracker.getExperienceSection()`.
2. **It works again.** `writeAction()` / `writeFlow()` finds the same code / body already recorded and
   skips the duplicate. The recipe was just executed successfully, so the existing record is marked used.
   Duplicate detection compares bodies with the usage comments stripped, otherwise stamped flows would
   never match and duplicates would pile up.
   This is what covers Navigator, which gets every recipe inline (`renderExperienceFor`) and never calls
   `learnExperience`.

Not counted: listing a record in a TOC or inlining it into a prompt, and the human `experience` CLI
command (`getExperienceSectionByTag`).

Usage is day based: when the existing `used` falls on the same local calendar day as now, the file is
not rewritten. Otherwise the `used` comment is replaced (or added after `added`).

Marking used respects `experience.disabled`, the same as every other write. The file is written back
to the path it was read from: a record found in a secondary experience directory (CWD, `INITIAL_CWD`) is
updated there, not copied into the primary directory.

## Forgetting unused records

ExperienceCompactor drops a record when all hold:

- it has an `added` comment older than `experience.forgetUnusedAfterDays` days,
- it has no `used` comment.

A record that was used once is kept; it ages out only through the existing AI review and compaction.
Records without `added` are kept and stamped.

The step is deterministic (no AI) and runs first in both `autocompact()` (on every start) and
`compactAllExperiences()` (`explorbot compact`), over all files, before the size filter of
`autocompact`. It writes a file when it removed a record or found an unstamped one.

Stamping and daily `used` writes change file mtime, which `isRecent()` (AI review gate) and
`experience --recent/--old` read. Accepted: the first start after this change stamps legacy files, so the
next `explorbot compact` AI-reviews them once; afterwards a file is recent exactly when one of its records
was added or used recently, which is what those checks mean.

### Config

```js
export default {
  experience: {
    forgetUnusedAfterDays: 30, // default 15; 0 or false keeps unused records forever
  },
};
```

ExperienceCompactor does not read config: ExplorBot passes the value when it creates the agent.

## Showing age to agents

Agents see how long ago each record last worked, so they can prefer recent ones.

TOC (`renderExperienceToc`, used by Tester, Pilot, Captain, Navigator retry, prima):

```
File A /users:
  A.1 ## ACTION: open the user menu (used 2 days ago)
  A.2 ## FLOW: create a user (used today)
  A.3 ## ACTION: filter by role (never used, added 9 days ago)
```

Inline recipes (`getSuccessfulExperience`, used by Navigator and Planner):

```
## HOW to open the user menu (single-step, used 2 days ago)
```

Wording: `used today`, `used yesterday`, `used N days ago`; `never used, added today/yesterday/N days ago`.
A record without comments gets no annotation.

The comments themselves are stripped from every body handed to an agent (`learnExperience`,
inline recipes, Planner flows, Historian's existing-experience summary) — the age annotation replaces them.

`experience.maxReadLines` counts lines with the usage comments stripped, so the metadata does not push
records out of the prompt.

`ExperienceTocEntry.sections[]` gains an `age` string (empty when unknown), so the `experience` CLI
command can show it too.

## Decisions taken without explicit instruction

- "Used" means read via `learnExperience` or re-recorded as a duplicate. Being listed in a TOC or inlined
  into a prompt does not count.
- Records without `added` are never deleted directly; they are stamped and get a full grace period.
- A used record is never deleted by the forgetting step, however old its last use.

## Not in scope

- Ranking or reordering records by usage. Agents get the age and judge.
- Changing prompt instructions. Whether the `<experience>` header should say "prefer recently used
  records" is a separate prompt change, to be approved word by word.
- Fixing mdq `replace()` on HTML blocks, which drops the blank line after the block (we remove and
  insert instead).

## Files

| File | Change |
|---|---|
| `src/experience-tracker.ts` | stamp `added` in `writeExperienceFile`; `markUsed` on section read and duplicate write; `age` in TOC; annotate + strip comments in recipes and section bodies; `markUsed` edits only the `used` comment of the raw file through mdq; tracker methods `getRecordUsage`, `stripUsageComments`, `restoreLastUsed` for the compactor and Historian |
| `src/ai/experience-compactor.ts` | `forgetUnusedRecords()` step in `autocompact` / `compactAllExperiences`; `forgetUnusedAfterDays` constructor option |
| `src/explorbot.ts` | pass `config.experience.forgetUnusedAfterDays` to the compactor |
| `src/config.ts` | `experience.forgetUnusedAfterDays?: number \| false` |
| `docs/reference/configuration.md` | document the option |
| `CLAUDE.md` | `added` / `used` comments in the Experience row of the envelope table |
| `tests/unit/experience-tracker.test.ts`, `tests/unit/experience-compactor.test.ts` | stamping, day-based used, annotations, forgetting |
