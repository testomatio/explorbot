import dedent from 'dedent';

export const helpContract = dedent`
  Prima drives the browser opened by playwright-cli.

    playwright-cli open <url>    starts the session
    prima <command> ...          drives it
    playwright-cli close         ends it

  One call runs a whole job:

    prima check "a workflow can be created and appears in the list" --expected "the new workflow is listed"
    prima do "open the account menu" "choose the settings entry" "switch the theme to dark" "check it took effect"
    prima pw "({ page }) => page.click('[data-test=submit]')"

  Only research maps a page. Other commands read the accessibility tree; a cached
  research map joins when present. On large or unclear pages, run prima research first.
  Without a usable AI model only pw works; otherwise use playwright-cli.
  DEBUG='explorbot:*' in front of a command logs everything it does.
`;

export const checkHelp = dedent`
  check states the outcome, not the clicks; it finds the path itself. It stays
  on the current page and never reloads it, so an open dialog survives.
  --expected  one required outcome, repeatable for several. Without it the
              scenario text is the outcome. Each returns under
              ### Expected outcomes as PASSED, FAILED, CONTRADICTION or not verified.
              "not verified" means never checked, not false.
  Proof is a full-page screenshot: what a user sees counts, the log only shows actions.
  CONTRADICTION means screenshot and log disagree; judge the html, aria and
  screenshot under ### Artifacts yourself.
  ok is false when any outcome FAILED or CONTRADICTED, or the run could not finish,
  reported as such rather than as an app failure.
  Side issues found on the way go under ### Answer, not as step failures.
`;

export const doHelp = dedent`
  ### Steps marks each instruction ok, FAIL or ??. ?? means it ran but the run ended
  without confirming it - read the steps above. Only FAIL fails the command.
  Nothing runs past the last instruction. Batch the whole sequence in one call;
  that is what keeps this tier cheap.
`;

export const askHelp = dedent`
  Answers from a page screenshot, or from its structure with --no-vision.
`;

export const verifyHelp = dedent`
  Reports each expressible assertion as PASSED or FAILED with its playwright form;
  no overall verdict, read the lines. "none ran" means unexpressible, not false.
`;

export const researchHelp = dedent`
  The map is saved per page state and joins later commands there, so one research run pays for all that follow it.
`;

export const statusHelp = dedent`
  Reads recorded files, so it needs no browser and outlives the session.
  The hash is matched across all recorded sites. ### Artifacts lists every kept
  file: aria, html, screenshot and network log when captured, plus per-step captures of a do run.
`;

export const reportHelp = dedent`
  Built from the command log, so it needs no browser and outlives the session.
  Reports the latest session unless --pw-session names another.
`;

export const sessionHelp = dedent`
  Parallel jobs need one --instance each. --session is ignored when attached,
  since the attached session keeps its own. --framework is parsed but inactive;
  reported code is CodeceptJS either way.
`;
