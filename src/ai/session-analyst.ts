import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import dedent from 'dedent';
import { outputPath } from '../config.ts';
import { Stats } from '../stats.ts';
import type { Test } from '../test-plan.ts';
import type { Agent } from './agent.ts';
import type { Provider } from './provider.ts';

export class SessionAnalyst implements Agent {
  emoji = '🧐';
  private provider: Provider;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  async analyze(tests: Test[]): Promise<string> {
    const eligible = tests.filter((t) => t.startTime != null);
    if (eligible.length === 0) return '';

    const model = this.provider.getAgenticModel('analyst');
    const customPrompt = this.provider.getSystemPromptForAgent('analyst', undefined);

    const systemPrompt = dedent`
      You write a TERSE end-of-session report. Reader is a developer who wants to UNDERSTAND THE FEATURE — what works, what is broken, what is unclear. Every word must earn its place.

      Output MARKDOWN. No JSON, no preamble, no closing summary.

      NO EMOJI. No 🔴 🟡 🟢 ✅, no escape sequences like \\u2705. Use plain text severity tags: [High], [Medium], [Low] for defects.

      ## Reporting unit

      Report at the level of FEATURES / FLOWS / PAGES. Tests are evidence, not the unit. Several tests covering the same flow → ONE entry citing all of them.

      ## Walk every test

      PASSED test: did all steps run, was the goal actually verified, did the user-visible goal happen? All yes → contributes to What works. Any no → Execution issue (false positive).

      FAILED test, first match wins: (1) goal achieved but mis-verified → Execution. (2) automation failure (locator/timeout/loop/modal/a11y) → Execution. (3) bad preconditions or data → Execution. (4) wrong URL/environment → Execution. (5) app contradicted expected outcome → Defect.

      Crucial distinction: "the app misbehaved" vs "the automation could not interact with the app". ONLY the first is a Defect. If the automation gives up before the app responds — timeout, retries exhausted, dead loop / loop detected, could not click or find an element — that is an Execution issue regardless of what the log calls it. Failure inside the automation ≠ failure inside the product.

      The action log is more authoritative than the scenario title. If the actual submitted data, page state, or action sequence does not match the scenario title, classify it as Execution issue and do not list that scenario under What works. Do NOT infer a product Defect or UX issue from behavior caused by incorrect test data or an automation mismatch.
      Negative test data is valid when it matches a negative scenario. Do not call intentionally invalid input wrong data when the scenario expects rejection or validation feedback.

      A solitary failure where adjacent tests on the same feature passed → Execution, not Defect.

      ## Severity (defects only)
      [High] blocks a core flow · [Medium] degrades a flow but workaround exists · [Low] cosmetic / edge case

      ## Naming tests
      Reference every test by its full label wrapped in backticks: \`\`\`ET-<number> <test title>\`\`\` — the \`ref\` and \`scenario\` from its \`<test>\` block. Backticks only, never bold. Never write a bare \`#2\`.

      ## Format

      # Session Analysis

      <ONE or TWO sentences describing the FEATURE STATE — what was explored, whether the core flow holds, what the standout problem is. NO test counts, NO "N tests run". Talk about the product, not the run.>

      ## Coverage
      - Pages: <paths>
      - Features: <capabilities>

      ## What works
      - **<feature>** — \`ET-2 <title>\`, \`ET-7 <title>\`

      ## Defects

      ### [Medium] <plain-English bug title>
      Affects: \`ET-3 <title>\`, \`ET-5 <title>\`
      Reproduce:
        1. <concrete UI step>
        2. <next>
      Evidence: <one short observation>

      ## UX issues
      - **<feature>** — <what's confusing> (\`ET-7 <title>\`)

      ## Execution Issues
      - \`ET-2 <title>\` — <≤10 words, what was unreliable>

      ## Brevity rules

      - Headline: 2 sentences MAX. About the FEATURE, not the run. No counts, no "N tests", no "this session". Never use these words: "exercised", "comprehensive", "notably", "this session", "module", "targeted", "covered creation".
      - What works: feature name + test refs. NO parentheticals, NO caveats. If there's a caveat, the entry doesn't belong here.
      - Defect title is the BUG ("Search returns non-matching results"), never the scenario name.
      - Reproduce steps are imperative one-liners drawn from the log.
      - Evidence is one short factual observation. Never quote the \`result\` field.
      - Execution Issues: ONE line per test, ≤10 words, plain. Examples: "passed vacuously, no list assertion", "no file upload step in log", "dead loop on Save click". No prefixes, no nested explanation.
      - Omit any empty section.
      - Section order: Coverage → What works → Defects (severity desc) → UX issues → Execution Issues.

      ${customPrompt || ''}
    `;

    const userPayload = dedent`
      ${eligible.length} tests were executed in this session.

      ${eligible.map((t, i) => this.serializeTest(t, i + 1)).join('\n\n')}
    `;

    const response = await this.provider.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload },
      ],
      model,
      { agentName: 'analyst' }
    );

    return decodeEscapes((response?.text || '').trim());
  }

  writeReport(markdown: string): string {
    const filePath = outputPath('reports', `${Stats.sessionLabel()}.md`);
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, markdown);
    return filePath;
  }

  private serializeTest(test: Test, ref: number): string {
    const log = test
      .getLog()
      .slice(-30)
      .map((entry) => `  - [${entry.type}] ${entry.content}`)
      .join('\n');
    const checked = test.getCheckedExpectations().join(' | ') || '(none)';
    const remaining = test.getRemainingExpectations().join(' | ') || '(none)';
    const notes = test
      .getPrintableNotes()
      .slice(-12)
      .map((note) => `  - ${note}`)
      .join('\n');
    const visitedUrls = test.getVisitedUrls({ localOnly: true }).join(' | ') || '(none)';
    const verification = test.verification
      ? dedent`
          verification_status: ${test.verification.status || 'unknown'}
          verification_message: ${test.verification.message || '(none)'}
          verification_url: ${test.verification.url || '(none)'}
          verification_page: ${test.verification.pageLabel || '(none)'}
          verification_details:
          ${(test.verification.details.length > 0 ? test.verification.details : ['(none)']).map((detail) => `  - ${detail}`).join('\n')}
        `
      : 'verification_status: none';

    return dedent`
      <test ref="ET-${ref}">
      url: ${test.startUrl || '/'}
      scenario: ${test.scenario}
      result: ${test.result || 'unknown'}
      expected: ${test.expected.join(' | ') || '(none)'}
      checked_expectations: ${checked}
      remaining_expectations: ${remaining}
      visited_urls: ${visitedUrls}
      ${verification}
      notes:
      ${notes || '  - (none)'}
      log:
      ${log}
      </test>
    `;
  }
}

function decodeEscapes(text: string): string {
  return text.replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
}
