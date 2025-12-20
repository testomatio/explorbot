import dedent from 'dedent';

export const locatorRule = dedent`
  First look for locators in <aria> section, they target browser internal representation, thus more reliable.
  Aria locators have role and text, you should provide them in the following format:

  Aria locators must be formatted as valid JSON object with role and text keys!

  <good_aria_locator_example>
  { "role": "button", "text": "Login" },
  { "role": "input", "text": "Name" },
  { "role": "link", "text": "Forgot your password?" },
  { "role": "link", "text": "Sign Up" },
  { "role": "button", "text": "Sign In" },
  { "role": "button", "text": "Submit" },
  { "role": "button", "text": "Cancel" }
  </good_aria_locator_example>

  Prefer ARIA locators over CSS/XPath locators.
  If <aria> section is not present or does not contain relevant locators, look for CSS/XPath locators in <html> section.
  Use ARIA locators when interacting with form elements
  Use ARIA locators when interacting with select, dropdown, combobox, radio buttons, checkboxes, etc

  Stick to semantic attributes like role, aria-*, id, class, name, data-id, etc.  
  XPath locator should always start with //
  Do not include element order like /div[2] or /div[2]/div[2] etc in locators.
  Avoid listing unnecessary elements inside locators
  Avoid locators that with names of frontend frameworks (vue, react, angular, etc) and numbers in them
  Avoid locators that seem to have generated ids or class names (long random numbers, uuids, etc)
  Use wide-range locators like // or * and prefer elements that have ids, classes, names, or data-id attributes, prefer element ids, classes, names, and other semantic attributes.
  CSS pseudo classes ARE NOT SUPPORTED. DO NOT use :contains, :first, :last, :nth-child, :nth-last-child, :nth-of-type, :nth-last-of-type, :only-child, :only-of-type, :empty, :not, etc

  <good locator example>
    { "role": "button", "text": "Login" },
    { "role": "input", "text": "Name" },
    { "role": "combobox", "text": "Enabled" },
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
    'button:contains("Login")'
    '//table//tbody/tr[1]//button[contains(@onclick='fn()')]")
    '//html/body/div[2]/div[2]/div/form/input[@name="name"]'
    '//html/body/div[2]/div[2]/div/form/input[@name="name"]'
    vue-button-123
  </bad locator example>

  HTML locators must be valid JS strings
`;

export const multipleLocatorRule = dedent`
  You will need to provide multiple solutions to achieve the result.
  
  Use different locator strategies: button names, input labels, placeholders, CSS, XPath.

  The very first solution should be with shortest and simplest locator.
  Be specific about locators, check if multiple elements can be selected by the same locator.
  While the first element can be a good solution, also propose solutions with locators that can pick other valid elements.

  Each new solution should pick the longer and more specific path to element.
  Each new solution should start with element from higher hierarchy with id or data-id attributes.
  When suggesting a new XPath locator do not repeat previously used same CSS locator and vice versa.
  Each new locator should at least take one step up the hierarchy.

  Don not include comments into code blocks.

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

  Solutions should be different, do not repeat the same locator in different solutions.
  The very last solution should use XPath that starts from '//html/body/' XPath and provides path to the element.
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

export const verificationActionRule = dedent`
  <actions>
  ### I.see

  checks that text is visible on the page

  <example>
    I.see('Welcome'); // checks text "Welcome" is visible anywhere on page
    I.see('Welcome', '.message'); // checks text "Welcome" is visible inside element with class "message"
    I.see('Welcome', '#header'); // checks text inside element with id "header"
  </example>

  ### I.seeInTitle

  checks that page title contains expected text

  <example>
    I.seeInTitle('Dashboard'); // checks page title contains "Dashboard"
  </example>

  ### I.seeInSource

  checks that page source contains expected text (including hidden elements)

  <example>
    I.seeInSource('<div class="hidden">'); // checks raw HTML source
  </example>

  ### I.seeElement

  checks that element is present on the page

  <example>
    I.seeElement('.success-message'); // checks element with class exists
    I.seeElement('#submit-button'); // checks element with id exists
    I.seeElement('//div[@data-testid="result"]'); // checks element by XPath
  </example>

  ### I.dontSee

  checks that text is NOT visible on the page

  <example>
    I.dontSee('Error'); // checks text "Error" is not visible
    I.dontSee('Error', '.alert'); // checks text is not visible in specific element
  </example>

  ### I.dontSeeInSource

  checks that page source does NOT contain expected text

  <example>
    I.dontSeeInSource('error-class'); // checks raw HTML does not contain text
  </example>

  [DO NEVER USE OTHER CODECEPTJS COMMANDS THAN PROPOSED HERE]
  [INTERACT ONLY WITH ELEMENTS THAT ARE ON THE PAGE HTML]
  [DO NOT USE WAIT FUNCTIONS]

  </actions>
  `;

export function outputRule(maxAttempts: number): string {
  return dedent`

    <rules>
    Do not invent locators, focus only on locators from HTML PAGE.
    Provide up to ${maxAttempts} various code suggestions to achieve the result.
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

    ${locatorRule}
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
      I.see('Welcome');
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
