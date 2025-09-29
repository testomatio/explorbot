import dedent from 'dedent';
import { ActionResult } from '../action-result.js';
import type { WebPageState } from '../state-manager.js';
import { createDebug, tag } from '../utils/logger.js';
import { loop } from '../utils/loop.js';
import type { Agent } from './agent.js';
import { ExperienceCompactor } from './experience-compactor.js';
import type { Provider } from './provider.js';
import { locatorRule as generalLocatorRuleText, multipleLocatorRule } from './rules.js';
import { createCodeceptJSTools } from './tools.js';

const debugLog = createDebug('explorbot:navigator');

export interface StateContext {
  state: WebPageState;
  knowledge: Array<{ filePath: string; content: string }>;
  experience: string[];
  recentTransitions: Array<{
    fromState: WebPageState | null;
    toState: WebPageState;
    codeBlock: string;
  }>;
  html?: string;
}

class Navigator implements Agent {
  emoji = '🧭';
  private provider: Provider;
  private experienceCompactor: ExperienceCompactor;

  private MAX_ATTEMPTS = Number.parseInt(process.env.MAX_ATTEMPTS || '5');

  private systemPrompt = dedent`
  <role>
    You are senior test automation engineer with master QA skills.
    You write test automation in CodeceptJS.
  </role>
  <task>
    You are given the web page and a message from user.
    You need to resolve the state of the page based on the message.
  </task>
  `;

  constructor(provider: Provider) {
    this.provider = provider;
    this.experienceCompactor = new ExperienceCompactor(provider);
  }

  async resolveState(message: string, actionResult: ActionResult, context?: StateContext): Promise<string> {
    const state = context?.state;
    if (!state) {
      throw new Error('State is required');
    }

    tag('info').log('AI Navigator resolving state at', state.url);
    debugLog('Resolution message:', message);

    let knowledge = '';

    if (context?.knowledge.length > 0) {
      const knowledgeContent = context.knowledge.map((k) => k.content).join('\n\n');

      tag('substep').log(`Found ${context.knowledge.length} relevant knowledge file(s) for: ${context.state.url}`);
      knowledge = `
        <hint>
        Here is relevant knowledge for this page:

        ${knowledgeContent}
        </hint>`;
    }

    const prompt = dedent`
      <message>
        ${message}
      </message>

      <task>
        Identify the actual request of the user.
        Identify what is expected by user.
        Identify what might have caused the error.
        Propose different solutions to achieve the result.
        Solution should be valid CodeceptJS code.
        Use only data from the <page> context to plan the solution.
        Try various ways to achieve the result
      </task>


      <page>
        ${actionResult.toAiContext()}

        HTML:

        ${await actionResult.simplifiedHtml()}
      </page>


      ${knowledge}

      ${await this.experienceRule(context)}

      ${this.actionRule()}

      ${this.outputRule()}
    `;

    debugLog('Sending prompt to AI provider');

    tag('debug').log('Prompt:', prompt);

    const response = await this.provider.chat([
      { role: 'user', content: this.systemPrompt },
      { role: 'user', content: prompt },
    ]);

    const aiResponse = response.text;

    tag('info').log(aiResponse.split('\n')[0]);

    debugLog('Received AI response:', aiResponse.length, 'characters');

    return aiResponse;
  }

  async changeState(message: string, actionResult: ActionResult, context?: StateContext, actor?: any): Promise<ActionResult> {
    const state = context?.state;
    if (!state) {
      throw new Error('State is required');
    }

    if (!actor) {
      throw new Error('CodeceptJS actor is required for changeState');
    }

    tag('info').log('AI Navigator changing state for:', state.url);
    debugLog('Change message:', message);

    const tools = createCodeceptJSTools(actor);

    const systemPrompt = dedent`
      <role>
        You are a senior web automation engineer with expertise in CodeceptJS.
        Your task is to interact with web pages using available tools to achieve user goals.
      </role>
      <approach>
        Analyze the page state, plan your actions, then execute them step by step.
        Be methodical and precise in your interactions.
        After each action, you'll automatically receive the updated page state.
        Use this feedback to decide your next actions dynamically.
        Continue until the task is complete or you determine it cannot be completed.

        Use click() for buttons, links, and clickable elements.
        Use type() for text input - you can specify a locator to focus first, or type without locator for active element.
      </approach>
    `;

    const userPrompt = dedent`
      <message>
        ${message}
      </message>

      <task>
        You need to perform actions on the current web page to fulfill the user's request.
        Use the provided tools (click and type) to interact with the page.

        Each tool call will automatically return the new page state after the action.
        Use this feedback to dynamically plan your next steps.
        Continue making tool calls until the task is completed.
      </task>

      <current_page>
        ${actionResult.toAiContext()}

        HTML:
        ${await actionResult.simplifiedHtml()}
      </current_page>
    `;

    try {
      // Use AI SDK's native tool calling with automatic roundtrips
      tag('info').log('🤖 Starting AI dynamic navigation with tool calling');
      const response = await this.provider.generateWithTools(
        [
          { role: 'user', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        tools,
        { maxToolRoundtrips: 5 }
      );

      tag('success').log('Dynamic tool calling completed');
      debugLog('Final AI response:', response.text);

      // Capture final page state
      const finalActionResult = await this.capturePageState(actor);

      // Check if task was completed
      const taskCompleted = await this.isTaskCompleted(message, finalActionResult);
      if (taskCompleted) {
        tag('success').log('Task completed successfully');
      } else {
        tag('warning').log('Task may not be fully completed');
      }

      return finalActionResult;
    } catch (error) {
      tag('error').log('Error during dynamic tool calling:', error);

      // Return current state as fallback
      return await this.capturePageState(actor);
    }
  }

  private async capturePageState(actor: any): Promise<ActionResult> {
    try {
      const url = await actor.grabCurrentUrl();
      const title = await actor.grabTitle();
      const html = await actor.grabHTMLFrom('body');

      // Try to get screenshot if possible
      let screenshot = null;
      try {
        screenshot = await actor.saveScreenshot();
      } catch (error) {
        debugLog('Could not capture screenshot:', error);
      }

      return new ActionResult({
        url,
        title,
        html,
        screenshot,
        timestamp: new Date(),
      });
    } catch (error) {
      throw new Error(`Failed to capture page state: ${error}`);
    }
  }

  private locatorRule(): string {
    return dedent`
      <locators>

        ${multipleLocatorRule}

        ${generalLocatorRuleText}
      </locators>
    `;
  }

  private async experienceRule(context: StateContext): Promise<string> {
    if (!context?.experience.length) return '';

    let experienceContent = context?.experience.join('\n\n---\n\n');
    experienceContent = await this.experienceCompactor.compactExperience(experienceContent);
    tag('substep').log(`Found ${context.experience.length} experience file(s) for: ${context.state.url}`);

    return dedent`
      <experience>
      Here is the experience of interacting with the page.
      Learn from it to not repeat the same mistakes.
      If there was found successful solution to an issue, propose it as a first solution.
      If there is no successful solution, analyze failed intentions and actions and propose new solutions.
      Focus on successful solutions and avoid failed locators.

      ${experienceContent}

      </experience>
    `;
  }

  private outputRule(): string {
    return dedent`

      <rules>
      Do not invent locators, focus only on locators from HTML PAGE.
      Provide up to ${this.MAX_ATTEMPTS} various code suggestions to achieve the result.
      If there was already succesful solution in <experince> use it as a first solution.

      If no succesful solution was found in <experince> propose codeblocks for each area that can help to achieve the result.
      Do not stick only to the first found element as it might be hidden or not availble on the page.
      If you think HTML contains several areas that can help to achieve the result, propose codeblocks for each such area.
      Use exact locators that can pick the elements from each areas.
      Detect such duplicated areas by looking for duplicate IDs, data-ids, forms, etc.

      In <explanation> write only one line without heading or bullet list or any other formatting.
      Check previous solutions, if there is already successful solution, use it!
      CodeceptJS code must start with "I."
      All lines of code must be CodeceptJS code and start with "I."
      ${this.locatorRule()}
      </rules>

      <output>
      Your response must start explanation of what you are going to do to achive the result
      It is important to explain intention before proposing code.
      Response must also valid CodeceptJS code in code blocks.
      Propose codeblock from succesful solutions in <experince> first if they exist.
      Use only locators from HTML PAGE that was passed in <page> context.
      </output>


      <output_format>
        <explanation>

        \`\`\`js
        <code>
        \`\`\`
        </code>
        <code>
        \`\`\`
        </code>
        <code>
        \`\`\`
        </code>
      </output_format>

      <example_output>
      Trying to fill the form on the page

      \`\`\`js
        I.fillField('Name', 'Value');
        I.click('Submit');
      \`\`\`

      \`\`\`js
        I.fillField('//form/input[@name="name"]', 'Value');
      \`\`\`

      \`\`\`js
        I.fillField('#app .form input[name="name"]', 'Value');
      \`\`\`

      \`\`\`js
        I.fillField('/html/body/div/div/div/form/input[@name="name"]', 'Value');
      \`\`\`
      </example_output>

      If you don't know the answer, answer as:

      <example_output>
      \`\`\`js
        throw new Error('No resolution');
      \`\`\`
      </example_output>
    `;
  }

  private actionRule() {
    return dedent`
    <actions>
    ### I.click

    clicks on the element by its locator or by coordinates

    <example>
      I.click('Button'); // clicks on the button with text "Button"
      I.click('.button'); // clicks on the button with class "button"
      I.click('.button', 'user.form'); // clicks on the button with class "button" inside the form with id "user.form"
      I.click('//user/button'); // clicks on the button with XPath "//user/button"
      I.click('body', null, { position: { x: 20, y: 40 } }) // clicks on the body at position 20, 40
    </example>

    It is preferred to use button or link texts.
    If it doesn't work, use CSS or XPath locators.
    If it doesn't work, use coordinates.


    ### I.fillField

    fills the field with the given value

    <example>
      I.fillField('Username', 'John'); // fills the field located by name or placeholder or label "Username" with the text "John"
      I.fillField('//user/input', 'John'); // fills the field located by XPath "//user/input" with the text "John"
    </example>

    ### I.type

    type sends keyboard keys to the browser window, use it if fillField doesn't work.
    for instance, for highy customized input fields.

    <example>
      I.type('John'); // types the text "John" into the active element
    </example>

    Check example output:

    Assuming the follwing code if executed will change the state of the page:

    <example output>
      I.fillField('Name', 'Value');
      I.click('Submit');
    </example output>

    ### I.selectOption

    In case you deal with select elements, use selectOption instead of fillField.

    <example>
      I.selectOption('Choose Plan', 'Monthly'); // select by label
      I.selectOption('subscription', 'Monthly'); // match option by text
      I.selectOption('subscription', '0'); // or by value
      I.selectOption('//form/select[@name=account]','Premium');
      I.selectOption('form select[name=account]', 'Premium');
      I.selectOption({css: 'form select[name=account]'}, 'Premium');
    </example>

    [DO NEVER USE OTHER CODECEPTJS COMMANDS THAN PROPOSED HERE]
    [INTERACT ONLY WITH ELEMENTS THAT ARE ON THE PAGE HTML]
    [DO NOT USE WAIT FUNCTIONS]

    </actions>
    `;
  }

  private async isTaskCompleted(message: string, actionResult: ActionResult): Promise<boolean> {
    // Simple implementation - can be enhanced later
    // For now, consider task completed if no errors occurred
    return !actionResult.error;
  }

  async visit(url: string, explorer: any): Promise<void> {
    try {
      const action = explorer.createAction();

      await action.execute(`I.amOnPage('${url}')`);
      await action.expect(`I.seeInCurrentUrl('${url}')`);

      if (action.lastError) {
        await this.resolveNavigation(action, url, explorer);
      }
    } catch (error) {
      console.error(`Failed to visit page ${url}:`, error);
      throw error;
    }
  }

  private async resolveNavigation(action: any, url: string, explorer: any): Promise<void> {
    const stateManager = explorer.getStateManager();
    const actionResult = action.getActionResult() || ActionResult.fromState(stateManager.getCurrentState()!);
    const maxAttempts = 5;

    const originalMessage = `
      I tried to navigate to: ${url}
      And I expected to see the URL in the browser
      But I got error: ${action.lastError?.message || 'Navigation failed'}.
    `.trim();

    tag('info').log('Resolving navigation issue...');

    const codeBlocks: string[] = [];

    await loop(async ({ stop, iteration }) => {
      if (codeBlocks.length === 0) {
        const aiResponse = await this.resolveState(originalMessage, actionResult, stateManager.getCurrentContext());

        const blocks = extractCodeBlocks(aiResponse || '');
        if (blocks.length === 0) {
          stop();
          return;
        }
        codeBlocks.push(...blocks);
      }

      const codeBlock = codeBlocks.shift()!;

      try {
        tag('step').log(`Attempting resolution: ${codeBlock}`);
        await action.execute(codeBlock);
        await action.expect(`I.seeInCurrentUrl('${url}')`);

        if (!action.lastError) {
          tag('success').log('Navigation resolved successfully');
          stop();
          return;
        }
      } catch (error) {
        debugLog(`Resolution attempt ${iteration} failed:`, error);
      }
    }, maxAttempts);
  }
}

export { Navigator };

function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:js|javascript)?\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const code = match[1].trim();
    if (code && !code.includes('throw new Error')) {
      blocks.push(code);
    }
  }

  return blocks;
}
