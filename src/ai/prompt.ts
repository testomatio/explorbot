import path from 'node:path';
import debug from 'debug';
import type { ActionResult } from '../action-result';
import type { PromptParser } from '../prompt-parser';
import type { Provider } from './provider';

const debugLog = debug('explorbot:ai');

class PromptVocabulary {
  private provider: Provider;
  private promptParser: PromptParser;

  private MAX_ATTEMPTS = process.env.MAX_ATTEMPTS || 5;

  private systemPrompt = `
  <role>
    You are senior test automation engineer with master QA skills.
    You write code in CodeceptJS.
  </role>
  <task>
    You are given a state of the page and a message.
    You need to resolve the state of the page based on the message.
  </task>
  `;

  constructor(provider: Provider, promptParser: PromptParser) {
    this.provider = provider;
    this.promptParser = promptParser;
    this.promptParser.getAllPrompts().forEach((prompt) => {
      debugLog('Prompt loaded from', path.basename(prompt.filePath));
    });
  }

  async resolveState(state: ActionResult, message: string): Promise<string> {
    const stateRules = this.promptParser.getPromptsByCriteria({
      url: state.url,
    });

    debugLog('State rules:', stateRules);

    const prompt = `
      <message>
        ${message}
      </message>

      Look into context of this HTML page

      <page>
        ${state.toAiContext()}

        HTML:

        ${await state.getSimplifiedHtml()}
      </page>
      By performing CodeceptJS actions you need to change the state of the page in expected way.

      ${stateRules.map((rule) => rule.content).join('\n')}

      ${this.actionRule()}

      ${this.outputRule()}
    `;

    const response = await this.provider.chat([
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: prompt },
    ]);

    const aiResponse = response.text;
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
      Your response must contain only valid CodeceptJS code in code blocks.
      Provide up to ${this.MAX_ATTEMPTS} various code suggestions to achieve the result.

      Do not stick only to the first found element as it might be hidden or not availble on the page.
      If you think HTML contains several areas that can help to achieve the result, propose codeblocks for each such area.
      Use exact locators that can pick the elements from each areas.
      Detect such duplicated areas by looking for duplicate IDs, data-ids, forms, etc.
      If you found a duplicated area, you need to present code block for each such area.

      <rules>
      CodeceptJS code must start with "I."
      All lines of code must start with "I."
      ${this.locatorRule()}
      </rules>

      <example output>
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
      </example output>
      </output>

      If you don't know the answer, answer as:

      <example output>
      \`\`\`js
        throw new Error('No resolution');
      \`\`\`
      </example output>
    `;
  }

  private actionRule() {
    return `
    <actions>
    ### click

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


    ### fillField

    fills the field with the given value

    <example>
      I.fillField('Username', 'John'); // fills the field located by name or placeholder or label "Username" with the text "John"
      I.fillField('//user/input', 'John'); // fills the field located by XPath "//user/input" with the text "John"
    </example>

    ### type

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

    ### selectOption

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
    `;
  }
}

export { PromptVocabulary };
