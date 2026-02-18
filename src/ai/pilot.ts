import dedent from 'dedent';
import type { ActionResult } from '../action-result.ts';
import { ConfigParser } from '../config.ts';
import type { Test } from '../test-plan.ts';
import { tag } from '../utils/logger.ts';
import type { Agent } from './agent.ts';
import type { Conversation } from './conversation.ts';
import type { Provider } from './provider.ts';
import type { Researcher } from './researcher.ts';
import { isInteractive } from './task-agent.ts';

export class Pilot implements Agent {
  emoji = '🧭';
  private provider: Provider;
  private agentTools: any;
  private conversation: Conversation | null = null;
  private researcher: Researcher;

  constructor(provider: Provider, agentTools: any, researcher: Researcher) {
    this.provider = provider;
    this.agentTools = agentTools;
    this.researcher = researcher;
  }

  private get stepsToReview(): number {
    return (ConfigParser.getInstance().getConfig().ai?.agents as any)?.pilot?.stepsToReview ?? 5;
  }

  reset(): void {
    this.conversation = null;
  }

  async analyzeProgress(task: Test, currentState: ActionResult, testerConversation: Conversation): Promise<string> {
    tag('substep').log('🧭 Pilot analyzing progress...');

    if (!this.conversation) {
      this.conversation = this.provider.startConversation(this.getSystemPrompt(task), 'pilot');
    }

    const toolCalls = testerConversation.getToolExecutions().slice(-this.stepsToReview);
    const actionsContext = this.formatActions(toolCalls);
    const remaining = task.getRemainingExpectations();

    this.conversation.addUserText(dedent`
      URL: ${currentState.url}
      GOAL: ${remaining[0] || 'Complete scenario'}

      RECENT ACTIONS:
      ${actionsContext || 'None'}
    `);

    const result = await this.provider.generateWithTools(this.conversation.messages, this.provider.getModelForAgent('pilot'), this.agentTools, {
      maxToolRoundtrips: 3,
      agentName: 'pilot',
      experimental_telemetry: { functionId: 'pilot.analyze' },
    });

    const text = result?.text || '';
    this.conversation.addAssistantText(text);

    const contextToAttach = await this.fetchRequestedContext(text, currentState);

    if (contextToAttach) {
      return `${text}\n\n${contextToAttach}`;
    }

    return text;
  }

  private async fetchRequestedContext(text: string, currentState: ActionResult): Promise<string> {
    const parts: string[] = [];

    if (text.includes('ATTACH_HTML')) {
      const html = await currentState.simplifiedHtml();
      parts.push(dedent`
        <page_html>
        ${html}
        </page_html>
      `);
    }

    if (text.includes('ATTACH_ARIA')) {
      parts.push(dedent`
        <page_aria>
        ${currentState.ariaSnapshot}
        </page_aria>
      `);
    }

    if (text.includes('ATTACH_SUMMARY')) {
      const summary = await this.researcher.summary(currentState);
      if (summary) {
        parts.push(dedent`
          <page_summary>
          ${summary}
          </page_summary>
        `);
      }
    }

    if (text.includes('ATTACH_UI_MAP')) {
      const uiMap = await this.researcher.research(currentState);
      if (uiMap) {
        parts.push(dedent`
          <page_ui_map>
          ${uiMap}
          </page_ui_map>
        `);
      }
    }

    return parts.join('\n\n');
  }

  private formatActions(toolCalls: any[]): string {
    return toolCalls
      .map((t) => {
        const s = t.wasSuccessful ? '✓' : '✗';
        const ariaDiff = t.output?.pageDiff?.ariaDiff || 'no change';
        return `${s} ${t.toolName}: ${t.input?.explanation || ''}\n   ariaDiff: ${ariaDiff}`;
      })
      .join('\n\n');
  }

  private getSystemPrompt(task: Test): string {
    const interactive = isInteractive();

    return dedent`
      You are Pilot - you guide test execution by analyzing progress and deciding what to do next.

      SCENARIO: ${task.scenario}

      Your job:
      1. Track test execution across iterations (you maintain conversation state)
      2. Detect stuck patterns (loops, repeated failures, no progress)
      3. Request additional context when needed
      4. Ask user for help when failures cannot be resolved

      Stuck patterns:
      - Actions succeed but ariaDiff shows "no change" = wrong element targeted
      - Same action repeated multiple times = loop
      - Only research/context calls, no action tools = not progressing
      - Same locator failing repeatedly = need different approach

      Tools available:
      - context() - get fresh ARIA snapshot
      - see() - get screenshot analysis
      - xpathCheck(xpath) - propose XPath to search for elements Tester can't find
      - askUser() - get help from human

      When Tester is stuck finding an element (same locator failing repeatedly):
      1. Use xpathCheck() with a broad XPath to locate the element
      2. Narrow down with more specific XPath until unique match found
      3. If found and visible, include the XPath or discovered attributes in NEXT instruction
      4. If found but NOT visible, suggest scrolling, clicking to expand, or waiting

      ${
        interactive
          ? dedent`
        USER INPUT IS AVAILABLE.
        If you detect failures that cannot be resolved, call askUser() to get help.
        The user can provide correct locators, explain UI, or suggest next steps.
      `
          : 'User input is NOT available.'
      }

      Response format:
      PROGRESS: <1 sentence assessment>
      ACTION: continue|alternative|visual|skip|reset|stop
      CONTEXT: <list if needed: ATTACH_SUMMARY, ATTACH_HTML, ATTACH_ARIA, ATTACH_UI_MAP>
      NEXT: <specific instruction, 3-10 words>

      Only request context that would actually help. Don't request all context every time.
    `;
  }
}
