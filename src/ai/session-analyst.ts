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

    const model = this.provider.getModelForAgent('analyst');
    const customPrompt = this.provider.getSystemPromptForAgent('analyst', undefined);

    const systemPrompt = dedent`
      You write a brief end-of-session report after autonomous exploratory testing. Your reader is a developer who needs to know in seconds: what is broken, how to reproduce it, and which results were inconclusive.

      Output MARKDOWN. No JSON, no preamble, no closing remarks. Start with the heading.

      ## Clustering
      Group by ROOT CAUSE, not by scenario. If three tests fail for the same dropdown, that is ONE defect listing all three test refs (#3, #5, #7). Do not produce one cluster per test.

      ## Bucketing
      Use the FINAL verdict (the test's \`result\` field) as the starting point. Mid-test errors that the automation recovered from do NOT make a passed test unreliable.

      - **Defect** — real product bug. \`result: failed\` AND the failure reflects the app misbehaving (not the automation). The automation completed its interactions, the app contradicted the expected outcome. Severity required.
      - **UX issue** — app works but the UI is ambiguous, controls are hidden, or labels are unclear. Worth flagging to design.
      - **Execution issue** — the FINAL verdict is unreliable. Only two cases:
        1. \`result: failed\` AND the failure was automation, environment, or UI/UX (locator missing, timeout, AI loop, navigation stuck, modal trapped focus, no accessible label) — i.e. the test could not conclude whether the app works.
        2. \`result: passed\` AND clear evidence in the log shows the user-visible goal was NOT achieved (no confirmation visible, no state change verified, the assertion was vacuous).

      A test that passed and shows no contrary evidence belongs in NO section. Do not list passed tests just because the log contains intermediate retries or recovered failures.

      ## Severity emoji (defects only)
      - 🔴 critical or high — core flow blocked, data loss, security
      - 🟡 medium — partial breakage with workaround
      - 🟢 low — cosmetic

      ## Required format

      # Session Analysis

      <one sentence: total tests, defect count, headline finding>

      ## Defects

      ### 🔴 <plain-English title of the BUG, not the scenario name>
      Affects: #3, #5, #7
      Reproduce:
        1. <concrete UI step a person can replay>
        2. <next step>
      Evidence: <one short observation from the test log>

      ### 🟡 <next defect>
      ...

      ## UX issues

      - **<title>** — #4
        <one short evidence line>

      ## Execution Issues

      - **<short test name or scenario phrase>** — <plain-English one-liner: what made the result unreliable>
      - **<…>** — <…>

      ## Rules
      - Defects first, sorted by severity descending. Omit any section that has zero entries.
      - Defect title describes the BUG ("Run-type dropdown does not filter"), never the scenario name.
      - Reproduce steps are concrete UI actions derived from the log: URL + clicks + inputs. Imperative, one short line each.
      - Evidence is the smallest factual observation from notes/steps that supports the claim — what was OBSERVED in the page (HTML, message, missing element). Never quote the test's \`result\` field as evidence; that is a tautology.
      - **Execution Issues** entries must explain what actually went wrong in concrete terms a human understands: "could not find a Submit button after navigation", "page reloaded before the assertion ran", "passed without ever seeing a confirmation message", "marked failed but the new item appears in the list", "modal trapped focus and tests could not click outside", "ARIA tree had no labelled controls". Avoid jargon like "locator failed" without context. Never write category prefixes ("execution:", "false-positive:") — the section header already says it. No emoji on these entries.
      - Do NOT include a passed test in any section unless evidence proves its goal was not achieved. Intermediate retries or recovered errors in the log are not grounds for listing a passed test.
      - No editorialising, no restating the scenario verbatim, no closing summary.

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

    return (response?.text || '').trim();
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
