import type { Provider } from './provider.js';
import type { WebPageState } from '../state-manager.js';
import type { ActionResult } from '../action-result.js';
import { ExperienceCompactor } from './experience-compactor.js';
import { tag, createDebug } from '../utils/logger.js';

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

class Navigator {
  private provider: Provider;
  private experienceCompactor: ExperienceCompactor;

  private MAX_ATTEMPTS = Number.parseInt(process.env.MAX_ATTEMPTS || '5');
  private MAX_EXPERIENCE_LENGTH = 5000;

  private systemPrompt = `
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

  async resolveState(
    message: string,
    actionResult: ActionResult,
    context?: StateContext
  ): Promise<string> {
    const state = context?.state;
    if (!state) {
      throw new Error('State is required');
    }

    tag('info').log('AI Navigator resolving state for:', state.url);
    debugLog('Resolution message:', message);

    let knowledge = '';

    if (context?.knowledge.length > 0) {
      const knowledgeContent = context.knowledge
        .map((k) => k.content)
        .join('\n\n');

      tag('substep').log(
        `Found ${context.knowledge.length} relevant knowledge file(s) for: ${context.state.url}`
      );
      knowledge = `
        <hint>
        Here is relevant knowledge for this page:

        ${knowledgeContent}
        </hint>`;
    }

    let prompt = `
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

      ${this.actionRule()}

      ${this.outputRule()}
    `;

    if (context?.experience.length > 0) {
      const experienceContent = context?.experience.join('\n\n---\n\n');
      const truncatedContent =
        experienceContent.length > this.MAX_EXPERIENCE_LENGTH
          ? `${experienceContent.slice(0, this.MAX_EXPERIENCE_LENGTH)}\n\n[Content truncated due to length limit]`
          : experienceContent;

      tag('substep').log(
        `Found ${context.experience.length} experience file(s) for: ${context.state.url}`
      );
      prompt += `

      <experience_rules>
      Here is a compacted summary of previously executed code blocks.
      Focus on successful solutions and avoid failed locators.
      Do not repeat code blocks that already failed.
      Analyze locators used in code blocks that failed and do not use them in your answer.
      Do not use any locators equal to failed ones.
      </experience_rules>
      <experience>
      ${truncatedContent}
      </experience>`;
    }

    debugLog('Sending prompt to AI provider');

    tag('debug').log('Prompt:', prompt);

    const response = await this.provider.chat([
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: prompt },
    ]);

    const aiResponse = response.text;

    tag('info').log(aiResponse.split('\n')[0]);

    debugLog('Received AI response:', aiResponse.length, 'characters');
    tag('debug').log(aiResponse);

    return aiResponse;
  }

  private locatorRule(): string {
    return `
      <locators>
        Use different locator strategies: button names, input labels, placeholders, CSS, XPath.

        You will need to provide multiple solutions to achieve the result.

        The very first solution should be with shortest and simplest locator.
        Be specific about locators, check if multiple elements can be selected by the same locator.
        While the first element can be a good solution, also propose solutions with locators that can pick other valid elements.

        Each new solution should pick the longer and more specific path to element.
        Each new solution should start with element from higher hierarchy with id or data-id attributes.
        When suggesting a new XPath locator do not repeat previously used same CSS locator and vice versa.
        Each new locator should at least take one step up the hierarchy.

        <bad_locator_example>
          Suggestion 1:
          #user_email

          Suggestion 2: (is the same as suggestion 1)
          //*[@id="user_email"]
        </bad_locator_example>

        <good_locator_example>
          Suggestion 1:
          #user_email

          Suggestion 2: (is more specific than suggestion 1)
          //*[@id="user_form"]//*[@id="user_email"]
        </good_locator_example>

        If locator is long prefer writing it as XPath.
        The very last solution should use XPath that starts from '//html/body/' XPath and provides path to the element.
        XPath locator should always start with // 
        Do not stick to element order like /div[2] or /div[2]/div[2] etc. 
        Use wide-range locators like // or * and prefer elements that have ids, classes, names, or data-id attributes, prefer element ids, classes, names, and other semantic attributes.

        <good locator example>
          I.fillField('form#user_form input[name="name"]', 'Value');
          I.fillField('#content-top #user_name', 'Value');
          I.fillField('#content-bottom #user_name', 'Value');
          I.fillField('#content-top form input[name="name"]', 'Value');
          I.fillField('//html/body//[@id="content-top"]//form//input[@name="name"]', 'Value');
          I.fillField('//html/body//[@id="content-bottom"]//form//input[@name="name"]', 'Value');
        </good locator example>

        <bad locator example>
          I.fillField('//html/body/div[2]/div[2]/div/form/input[@name="name"]', 'Value');
          I.fillField('//html/body/div[2]/div[2]/div/form/input[@name="name"]', 'Value');
        </bad locator example>

        Solutions should be different, do not repeat the same locator in different solutions.
      </locators>
    `;
  }

  private outputRule(): string {
    return `
      <output>
      Your response must start explanation of what you are going to do to achive the result
      And then contain valid CodeceptJS code in code blocks.
      Provide up to ${this.MAX_ATTEMPTS} various code suggestions to achieve the result.

      Do not stick only to the first found element as it might be hidden or not availble on the page.
      If you think HTML contains several areas that can help to achieve the result, propose codeblocks for each such area.
      Use exact locators that can pick the elements from each areas.
      Detect such duplicated areas by looking for duplicate IDs, data-ids, forms, etc.
      If you found a duplicated area, you need to present code block for each such area.

      <rules>
      In <explanation> write only one line without heading or bullet list or any other formatting.
      CodeceptJS code must start with "I."
      All lines of code must start with "I."
      ${this.locatorRule()}
      </rules>

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
    return `
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

    </actions>

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
    </actions>

    ### I.waitForInvisible

    If you see that there is a spinner or loading indicator, use waitForInvisible to wait for it to be invisible.

    <example>
      I.waitForInvisible('.spinner', 30); // waits for the spinner to be invisible or for 30 seconds
    </example>
    `;
  }
}

export { Navigator };
