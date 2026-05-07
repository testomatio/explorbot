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

      A solitary failure where adjacent tests on the same feature passed → Execution, not Defect.

      ## Severity (defects only)
      [High] blocks a core flow · [Medium] degrades a flow but workaround exists · [Low] cosmetic / edge case

      ## Format

      # Session Analysis

      <ONE or TWO sentences describing the FEATURE STATE — what was explored, whether the core flow holds, what the standout problem is. NO test counts, NO "N tests run". Talk about the product, not the run.>

      ## Coverage
      - Pages: <paths>
      - Features: <capabilities>

      ## What works
      - **<feature>** — #2, #7, #8

      ## Defects

      ### [Medium] <plain-English bug title>
      Affects: #3, #5
      Reproduce:
        1. <concrete UI step>
        2. <next>
      Evidence: <one short observation>

      ## UX issues
      - **<feature>** — <what's confusing> (#7)

      ## Execution Issues
      - **#2 <scenario>** — <≤10 words, what was unreliable>

      ## Brevity rules

      - Headline: 2 sentences MAX. About the FEATURE, not the run. No counts, no "N tests", no "this session". Banned words: "exercised", "comprehensive", "notably", "this session", "module", "targeted", "covered creation".
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

    return dedent`
      <test ref="#${ref}">
      url: ${test.startUrl || '/'}
      scenario: ${test.scenario}
      result: ${test.result || 'unknown'}
      expected: ${test.expected.join(' | ') || '(none)'}
      log:
      ${log}
      </test>
    `;
  }
}

function decodeEscapes(text: string): string {
  return text.replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
}
