import dedent from 'dedent';
import { ActionResult } from '../action-result.js';
import { ExperienceTracker } from '../experience-tracker.js';
import Explorer from '../explorer.ts';
import { KnowledgeTracker } from '../knowledge-tracker.js';
import type { WebPageState } from '../state-manager.js';
import { extractCodeBlocks } from '../utils/code-extractor.js';
import { createDebug, tag } from '../utils/logger.js';
import { loop } from '../utils/loop.js';
import type { Agent } from './agent.js';
import type { Conversation } from './conversation.js';
import { ExperienceCompactor } from './experience-compactor.js';
import { Researcher } from './researcher.ts';
import type { Provider } from './provider.js';
import { locatorRule as generalLocatorRuleText, multipleLocatorRule } from './rules.js';

const debugLog = createDebug('explorbot:navigator');

class Navigator implements Agent {
  emoji = '🧭';
  private provider: Provider;
  private experienceCompactor: ExperienceCompactor;
  private knowledgeTracker: KnowledgeTracker;
  private experienceTracker: ExperienceTracker;
  private currentAction: any = null;
  private currentUrl: string | null = null;

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
  private freeSailSystemPrompt = dedent`
  <role>
    You help with exploratory web navigation.
  </role>
  <rules>
    Always propose a single next navigation target that was not visited yet.
    Base the suggestion only on the provided research notes and HTML snapshot.
    Respond with exactly two lines:
    Next: <target>
    Reason: <short justification>
  </rules>
  `;
  private explorer: Explorer;

  constructor(explorer: Explorer, provider: Provider, experienceCompactor: ExperienceCompactor) {
    this.provider = provider;
    this.explorer = explorer;
    this.experienceCompactor = experienceCompactor;
    this.knowledgeTracker = new KnowledgeTracker();
    this.experienceTracker = new ExperienceTracker();
  }

  async visit(url: string): Promise<void> {
    try {
      const action = this.explorer.createAction();

      await action.execute(`I.amOnPage('${url}')`);
      await action.expect(`I.seeInCurrentUrl('${url}')`);

      if (action.lastError) {
        const actionResult = action.actionResult || ActionResult.fromState(action.stateManager.getCurrentState()!);
        const originalMessage = `
          I tried to navigate to: ${url}
          And I expected to see the URL in the browser
          But I got error: ${action.lastError?.message || 'Navigation failed'}.
        `.trim();

        // Store action and url for execution in resolveState
        this.currentAction = action;
        this.currentUrl = url;
        await this.resolveState(originalMessage, actionResult);
      }
    } catch (error) {
      console.error(`Failed to visit page ${url}:`, error);
      throw error;
    }
  }

  async resolveState(message: string, actionResult: ActionResult): Promise<boolean> {
    tag('info').log('AI Navigator resolving state at', actionResult.url);
    debugLog('Resolution message:', message);

    let knowledge = '';
    let experience = '';

    const relevantKnowledge = this.knowledgeTracker.getRelevantKnowledge(actionResult);
    if (relevantKnowledge.length > 0) {
      const knowledgeContent = relevantKnowledge.map((k) => k.content).join('\n\n');
      knowledge = `
      <hint>
      Here is relevant knowledge for this page:
      ${knowledgeContent}
      </hint>`;
    }

    const relevantExperience = this.experienceTracker.getRelevantExperience(actionResult).map((experience) => experience.content);

    if (relevantExperience.length > 0) {
      const experienceContent = relevantExperience.join('\n\n---\n\n');
      experience = await this.experienceCompactor.compactExperience(experienceContent);
      tag('substep').log(`Found ${relevantExperience.length} experience file(s) for: ${actionResult.url}`);

      experience = dedent`
      <experience>
      Here is the experience of interacting with the page.
      Learn from it to not repeat the same mistakes.
      If there was found successful solution to an issue, propose it as a first solution.
      If there is no successful solution, analyze failed intentions and actions and propose new solutions.
      Focus on successful solutions and avoid failed locators.

      ${experienceContent}

      </experience>`;
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

      ${experience}

      ${this.actionRule()}

      ${this.outputRule()}
    `;

    debugLog('Sending prompt to AI provider');

    tag('debug').log('Prompt:', prompt);

    const conversation = this.provider.startConversation(this.systemPrompt);
    conversation.addUserText(prompt);

    let codeBlocks: string[] = [];

    let resolved = false;
    await loop(
      async ({ stop, iteration }) => {
        if (codeBlocks.length === 0) {
          const result = await this.provider.invokeConversation(conversation);
          if (!result) return;
          const aiResponse = result?.response?.text;
          tag('info').log(aiResponse?.split('\n')[0]);
          debugLog('Received AI response:', aiResponse.length, 'characters');
          tag('step').log('Resolving navigation issue...');
          codeBlocks = extractCodeBlocks(aiResponse ?? '');
        }

        if (codeBlocks.length === 0) {
          return;
        }

        const codeBlock = codeBlocks[iteration - 1];
        if (!codeBlock) {
          stop();
          return;
        }

        tag('step').log(`Attempting resolution: ${codeBlock}`);
        resolved = await this.currentAction.attempt(codeBlock, iteration, message);

        if (resolved) {
          tag('success').log('Navigation resolved successfully');
          stop();
          return;
        }
      },
      {
        maxAttempts: this.MAX_ATTEMPTS,
        catch: async (error) => {
          debugLog(error);
          resolved = false;
        },
      }
    );

    return resolved;
  }

  async freeSail(actionResult?: ActionResult): Promise<{ target: string; reason: string } | null> {
    const stateManager = this.explorer.getStateManager();
    const state = stateManager.getCurrentState();
    if (!state) {
      return null;
    }

    const currentActionResult = actionResult || ActionResult.fromState(state);
    const research = Researcher.getCachedResearch(state) || '';
    const combinedHtml = await currentActionResult.combinedHtml();

    const history = stateManager.getStateHistory();
    const visited = new Set<string>();
    const normalize = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return '';
      if (trimmed === '/') return trimmed;
      const withoutSlash = trimmed.replace(/\/+$/, '');
      return withoutSlash.toLowerCase();
    };

    const pushVisited = (value?: string | null) => {
      if (!value) return;
      const normalized = normalize(value);
      if (normalized) visited.add(normalized);
    };

    history.forEach((transition) => {
      pushVisited(transition.toState.url);
      pushVisited(transition.toState.fullUrl);
    });
    pushVisited(state.url);
    pushVisited(state.fullUrl);

    const visitedList = [...visited];
    const visitedBlock = visitedList.length > 0 ? visitedList.join('\n') : 'none';

    const prompt = dedent`
      <research>
      ${research || 'No cached research available'}
      </research>

      <page_html>
      ${combinedHtml}
      </page_html>

      <context>
      Current URL: ${currentActionResult.url || 'unknown'}
      Visited URLs:
      ${visitedBlock}
      </context>

      <task>
      Suggest a new navigation target that has not been visited yet and can be reached from the current page.
      </task>
    `;

    const conversation = this.provider.startConversation(this.freeSailSystemPrompt);
    conversation.addUserText(prompt);

    let suggestion: { target: string; reason: string } | null = null;

    await loop(
      async ({ stop }) => {
        const result = await this.provider.invokeConversation(conversation);
        const text = result?.response?.text?.trim();
        if (!text) {
          stop();
          return;
        }

        const nextMatch = text.match(/Next:\s*(.+)/i);
        const reasonMatch = text.match(/Reason:\s*(.+)/i);
        const target = nextMatch?.[1]?.trim();
        if (!target) {
          stop();
          return;
        }

        const normalizedTarget = normalize(target);
        if (normalizedTarget && visited.has(normalizedTarget)) {
          conversation.addUserText(
            dedent`
            The suggestion "${target}" was already visited. Choose another destination not in this list:
            ${visitedBlock}
            `
          );
          return;
        }

        suggestion = {
          target,
          reason: reasonMatch?.[1]?.trim() || '',
        };
        stop();
      },
      { maxAttempts: 3 }
    );

    return suggestion;
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

      ${multipleLocatorRule}

      ${generalLocatorRuleText}
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
}

export { Navigator };
