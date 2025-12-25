import dedent from 'dedent';

export const locatorRule = dedent`
  <locator_priority>
  Use the following priority when selecting locators:

  1. ARIA locators (first choice) - target browser's accessibility tree, most reliable
     Use JSON format: { "role": "button", "text": "Login" }
     Best for: buttons, links, inputs, form controls, dropdowns, checkboxes, radio buttons
  
  2. Text locators (second choice) - use only when text is unique on the page
     Example: 'Login', 'Submit', 'Username'
     Skip if the same text appears multiple times on the page
  
  3. CSS selectors (third choice) - when ARIA/text don't work
     Prefer semantic attributes: id, name, data-testid, aria-label, placeholder
     Example: '#login-btn', '[data-testid="submit"]', 'form#login input[name="email"]'
  
  4. XPath (last resort) - for complex hierarchy or when CSS can't express the path
     Always start with //, never use positional indices like [1], [2]
     Example: '//form[@id="login"]//input[@name="email"]'
  </locator_priority>

  <disambiguation>
  When multiple elements could match the request, select based on intent:
  1. Match the context of recent actions - if filling a form, use elements in that same form
  2. Follow form flow - forms are filled top-to-bottom, left-to-right
     - If you just filled a field, the next target is likely below/after it in the DOM
  3. Use ARIA snapshot to identify element state (focused, visible, selected, expanded, etc.)
  4. Match semantic proximity - elements near fields you just interacted with

  Once the correct element is identified pick the best unique locator following priority: ARIA → CSS → XPath
  </disambiguation>

  ARIA locators must specify role. Specify locator type as JSON string with role and text keys.

  <good_aria_locator_example>
  { "role": "button", "text": "Login" },
  { "role": "input", "text": "Name" },
  { "role": "link", "text": "Forgot your password?" },
  { "role": "link", "text": "Sign Up" },
  { "role": "button", "text": "Sign In" },
  { "role": "button", "text": "Submit" },
  { "role": "button", "text": "Cancel" }
  </good_aria_locator_example>

  If <aria> section is not present or element is not found there, fall back to CSS/XPath locators from <html> section.

  Stick to semantic attributes like role, aria-*, id, class, name, data-id, etc.  
  XPath locator should always start with //
  Do not include element order like /div[2] or /div[2]/div[2] etc in locators.
  Avoid listing unnecessary elements inside locators
  Avoid locators that with names of frontend frameworks (vue, react, angular, etc) and numbers in them
  Avoid locators that seem to have generated ids or class names (long random numbers, uuids, etc)
  CSS pseudo classes ARE NOT SUPPORTED. DO NOT use :contains, :first, :last, :nth-child, :nth-last-child, :nth-of-type, :nth-last-of-type, :only-child, :only-of-type, :empty, :not, etc

  <good locator example>
    'div[role=input][placeholder="Name"]'
    '[aria-label="Name"]'
    'form#user_form input[name="name"]'
    '#content-top #user_name'
    '#content-bottom #user_name'
    '#content-top form input[name="name"]'
    '//html/body//[@id="content-top"]//form//input[@name="name"]'
    '//html/body//[@id="content-bottom"]//form//input[@name="name"]'
  </good locator example>

  <bad locator example>
    'button:contains("Login")' // contains not supported, use { "role":"button", "text":"Login" }
    '//table//tbody/tr[1]//button[contains(@onclick='fn()')]") // onclick is not semantic attribute
    '//html/body/div[2]/div[2]/div/form/input[@name="name"]' // position mentioned
    '//html/body/vue-button-123 // vue-framework specific locator
    'link "New Template"'  // WRONG: malformed string, use {"role":"link","text":"New Template"}
  </bad locator example>

  HTML locators must be valid JS strings
`;

export const multipleLocatorRule = dedent`
  You will need to provide multiple solutions to achieve the result.
  
  <short_vs_long_locators>
  Short locators = minimal selector that uniquely identifies the element
  - ARIA and Text locators are always short: { "role": "button", "text": "Submit" }, 'Login'
  - Short CSS: #email, [data-testid="submit"]
  
  Long locators = add ancestor context for resilience
  - CSS with ancestors: form#login #email, .modal .form input[name="email"]
  - XPath with path: //form[@id="login"]//input[@name="email"]
  - Full path to body (lowest priority): //html/body//div[@id="app"]//form//input[@name="email"]
  </short_vs_long_locators>

  Start with short locators (ARIA/Text first), then progressively try longer CSS/XPath.
  Long locators with full path are lowest priority but should still be tried as fallback.
  
  Be specific about locators, check if multiple elements can be selected by the same locator.
  Each new solution should add ancestor context, stepping up the hierarchy.
  When suggesting XPath, do not repeat the same CSS locator and vice versa.

  Do not include comments into code blocks.

  <bad_locator_example>
  Suggestion 1:
  #user_email

  Suggestion 2: (is the same as suggestion 1)
  //*[@id="user_email"]
  </bad_locator_example>

  <good_locator_example>
    Suggestion 1 (short - ARIA):
    { "role": "textbox", "text": "Email" }

    Suggestion 2 (short - CSS):
    #user_email

    Suggestion 3 (long - CSS with ancestor):
    #user_form #user_email

    Suggestion 4 (long - XPath with full path):
    //html/body//form[@id="user_form"]//input[@id="user_email"]
  </good_locator_example>

  Solutions should be different, do not repeat the same locator in different solutions.
`;

// in rage mode we do not protect from irreversible actions
export const protectionRule = dedent`
  <important>
  ${
    process.env.MACLAY_RAGE
      ? ''
      : `
    Do not trigger DELETE operations.
  `
  }

  Do not sign out current user of the application.
  Do not change current user account settings
  </important>
`;

export const generalWordsRule = dedent`
  Avoid using general words like "the page", "the element", "the button", "the input", "the link", "the form", "the table", "the list", "the item", "the page", "the element", "the button", "the input", "the link", "the form", "the table", "the list", "the item", "the page", "the element", "the button", "the input", "the link", "the form", "the table", "the list", "the item".
  "comprehensive",
  "All required"
  "All elements"
  "All necessary"
  `;

export const actionRule = dedent`
  <actions>
  ### I.click

  clicks on the element by its locator
  
  I.click(<locator>, <context_locator>)

  locators can be ARIA, CSS, or XPath locators.
  
  Use context parameter (second argument) to narrow click area when:
  - The same text/button appears multiple times on page
  - You need to click inside a specific form, modal, or section
  Context should be a CSS selector pointing to a unique container.

  <example>
    I.click('Submit', '#login-form');
    I.click('Button', '.sidebar');
    I.click({ role: 'button', text: 'Button' }, '.sidebar');
    I.click({ role: 'combobox', text: 'Select age' }, '.settings-panel');
    I.click('.sidebar .button');
    I.click('//form[@id="login"]//button');
  </example>

  Prefer text/ARIA locators with context over complex CSS/XPath selectors.
  If locator doesn't work, try CSS or XPath locators.
  If nothing works, use clickXY as last resort.


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

export const verificationActionRule = dedent`
  <actions>
  ### I.see

  I.see(<text>, <context>)

  Checks that text is visible inside a specific element.
  Context parameter is REQUIRED - never use I.see without context.

  <example>
    I.see('Welcome', '.message');
    I.see('Welcome', '#header');
    I.see('Success', '.notification');
  </example>

  ### I.seeElement

  I.seeElement(<locator>)

  Checks that element is present on the page.
  Prefer ARIA locators for reliable element detection.

  <example>
    I.seeElement({"role":"button","text":"Submit"});
    I.seeElement({"role":"alert","text":"Success"});
    I.seeElement('#submit-button');
    I.seeElement('.success-message');
  </example>

  ### I.seeInTitle

  I.seeInTitle(<text>)

  Checks that page title contains expected text.

  <example>
    I.seeInTitle('Dashboard');
  </example>

  ### I.seeInSource

  I.seeInSource(<text>)

  Checks that page source contains expected text (including hidden elements).

  <example>
    I.seeInSource('<div class="hidden">');
  </example>

  ### I.dontSee

  I.dontSee(<text>, <context>)

  Checks that text is NOT visible inside a specific element.
  Context parameter is REQUIRED - never use I.dontSee without context.

  <example>
    I.dontSee('Error', '.alert');
    I.dontSee('Failed', '.status');
  </example>

  ### I.dontSeeElement

  I.dontSeeElement(<locator>)

  Checks that element is NOT present on the page.

  <example>
    I.dontSeeElement('#error-message');
    I.dontSeeElement({"role":"alert","text":"Error"});
  </example>

  ### I.dontSeeInSource

  I.dontSeeInSource(<text>)

  Checks that page source does NOT contain expected text.

  <example>
    I.dontSeeInSource('error-class');
  </example>

  <verification_rules>
  Be strict in assertions to avoid false positives.
  Prefer I.seeElement() with ARIA locators - most reliable.
  I.see() and I.dontSee() MUST include context parameter.
  Only use locators that exist in the provided HTML or ARIA snapshot.
  Verify exact conditions, not approximate matches.
  </verification_rules>

  [DO NEVER USE OTHER CODECEPTJS COMMANDS THAN PROPOSED HERE]
  [INTERACT ONLY WITH ELEMENTS THAT ARE ON THE PAGE HTML OR ARIA SNAPSHOT]
  [DO NOT USE WAIT FUNCTIONS]

  </actions>
  `;

export function outputRule(maxAttempts: number): string {
  return dedent`

    <rules>
    Do not invent locators, focus only on locators from HTML PAGE.
    Provide up to ${maxAttempts} various code suggestions to achieve the result.
    If there was already successful solution in <experience> use it as a first solution.

    If no successful solution was found in <experience> propose codeblocks for each area that can help to achieve the result.
    Do not stick only to the first found element as it might be hidden or not availble on the page.
    If you think HTML contains several areas that can help to achieve the result, propose codeblocks for each such area.
    Use exact locators that can pick the elements from each areas.
    Detect such duplicated areas by looking for duplicate IDs, data-ids, forms, etc.

    In <explanation> write only one line without heading or bullet list or any other formatting.
    Check previous solutions, if there is already successful solution, use it!
    CodeceptJS code must start with "I."
    All lines of code must be CodeceptJS code and start with "I."

    ${multipleLocatorRule}

    ${locatorRule}
    </rules>

    <output>
    Your response must start explanation of what you are going to do to achive the result
    It is important to explain intention before proposing code.
    Response must also valid CodeceptJS code in code blocks.
    Propose codeblock from successful solutions in <experience> first if they exist.
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

export function verificationOutputRule(maxAttempts: number): string {
  return dedent`

    <rules>
    Do not invent locators, focus only on locators from HTML PAGE.
    Provide up to ${maxAttempts} various code suggestions to verify the assertion.
    If there was already successful solution in <experience> use it as a first solution.

    Propose codeblocks with different locator strategies to verify the same assertion.
    Use exact locators from the HTML page.

    In <explanation> write only one line without heading or bullet list or any other formatting.
    CodeceptJS code must start with "I."

    ${multipleLocatorRule}

    ${locatorRule}
    </rules>

    <output>
    Your response must start with explanation of what assertion you are going to verify.
    It is important to explain intention before proposing code.
    Response must contain valid CodeceptJS verification code in code blocks.
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
    Verifying that welcome message is visible on the page

    \`\`\`js
      I.seeElement({"role":"heading","text":"Welcome"});
    \`\`\`

    \`\`\`js
      I.see('Welcome', '.message');
    \`\`\`

    \`\`\`js
      I.see('Welcome', '#welcome-container');
    \`\`\`

    \`\`\`js
      I.seeElement('.welcome-message');
    \`\`\`
    </example_output>
  `;
}
