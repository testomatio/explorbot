import dedent from 'dedent';

const researchFirst = 'Run prima research first when a page is large or its structure is unclear.';

export const helpContract = dedent`
  Prima is a high-level AI extension to playwright-cli, driving the browser it has open.

    playwright-cli open <url>    starts the session
    prima <command> ...          drives it
    playwright-cli close         ends it

  One call takes a whole job:

    prima check "a workflow can be created and appears in the list" --expected "the new workflow is listed"
    prima do "open the account menu" "choose the settings entry" "switch the theme to dark" "check it took effect"
    prima pw "({ page }) => page.click('[data-test=submit]')"

  No command but research maps a page.
  ${researchFirst}
`;

export const pageContextHelp = dedent`
  Works from the accessibility tree, and never maps a page itself. Where prima research has
  already mapped a page, that map joins the context.
  ${researchFirst}
`;

export const checkHelp = dedent`
  check takes an outcome rather than a click path, and works out how to reach it. It runs
  on the page you are already on and never reloads it, so an open dialog survives the check.
  --expected  one outcome the run must reach, repeatable for several. Without it the
              scenario text is the single expected outcome. Each comes back under
              ### Expected outcomes as PASSED, FAILED, CONTRADICTION or not verified.
              "not verified" means the run never checked it, which is not the same
              as false.
  Outcomes are settled against a screenshot of the whole page: what a user can see is
  the proof, and the run log only says what was done. CONTRADICTION means the two
  disagree - reported with both sides rather than settled one way, so read the html,
  aria and screenshot named under ### Artifacts and judge it yourself. Not finding
  something in the picture is not enough on its own; that is "not verified".
  ok: follows those outcomes - false when one FAILED or CONTRADICTED, or when the run
  could not complete, which is reported as such rather than as an app failure.
  Page problems seen on the way appear under ### Answer, not as step failures.
`;

export const doHelp = dedent`
  Each instruction is numbered and accounted for: ### Steps reports each as ok, FAIL or ??.
  ?? means the action ran but the run ended without confirming that instruction - read the
  steps above it. Only FAIL and an instruction the page could not carry out fail the command.
  Nothing runs past the last instruction given. A whole remaining sequence in one call is
  what makes this tier cheap.
`;

export const askHelp = dedent`
  Answers from a screenshot of the page, or from its structure under --no-vision, and never maps
  the page itself.
  ${researchFirst}
`;

export const verifyHelp = dedent`
  Reports each assertion it could express as PASSED or FAILED with its playwright form,
  and gives no overall verdict - read the lines and decide. "none ran" means the claim
  could not be expressed, which is not the same as false.
`;

export const researchHelp = dedent`
  The map is kept under the page's state and joins the context of later commands on that page,
  so one research run pays for every command that follows it.
`;

export const statusHelp = dedent`
  Reads the files a command recorded, so it needs no browser and outlives the session.
  The hash is looked up across every recorded site. ### Artifacts names every file kept
  under it: the aria tree, the html, the screenshot and network log when they were
  captured, and the per-step captures of a do run.
`;

export const reportHelp = dedent`
  Commands are logged as they run, so the report needs no browser and outlives the session.
  The most recent session is reported unless --pw-session names another.
`;

export const sessionHelp = dedent`
  --endpoint <ep>    attach to a browser server endpoint directly, skipping discovery
  --instance <name>  which prima-owned browser you talk to; parallel work needs one each
  --session [file]   cookies and storage persisted across processes; ignored while
                     attached, since the attached session keeps its own
  --framework        parsed but not active yet; reported code is CodeceptJS either way
  DEBUG='explorbot:*' in front of a command prints the log of everything it does.
  When no AI model is usable pw still works; for everything else drive playwright-cli.
`;
