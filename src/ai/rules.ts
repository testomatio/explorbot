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

  For icon-only buttons/links with no visible text:
  - Use aria-label value if present: { "role": "button", "text": "Close" } (from aria-label="Close")
  - Use title attribute if present: { "role": "button", "text": "Settings" } (from title="Settings")
  - If no accessible name exists, mark ARIA as "-" and rely on CSS/XPath locators
  - NEVER use empty text: { "role": "button", "text": "" } is INVALID and useless

  <good_aria_locator_example>
  { "role": "button", "text": "Login" },
  { "role": "input", "text": "Name" },
  { "role": "link", "text": "Forgot your password?" },
  { "role": "link", "text": "Sign Up" },
  { "role": "button", "text": "Sign In" },
  { "role": "button", "text": "Submit" },
  { "role": "button", "text": "Cancel" },
  { "role": "button", "text": "Close" }  // from aria-label
  </good_aria_locator_example>

  <bad_aria_locator_example>
  { "role": "button", "text": "" }  // INVALID - empty text is useless, use "-" instead
  { "role": "button", "name": "Save" }  // WRONG key - use "text", not "name"
  </bad_aria_locator_example>

  If <aria> section is not present or element is not found there, fall back to CSS/XPath locators from <html> section.

  Stick to semantic attributes like role, aria-*, id, class, name, data-id, etc.
  Avoid locators with names of frontend frameworks (vue, react, angular, ember, etc) and numbers in them
  Avoid locators that seem to have generated ids or class names (long random numbers, uuids, etc)
  Avoid href-based locators like a[href="..."] or //a[@href="..."] - URLs change frequently, use text or ARIA instead
  Avoid CSS framework utility classes as containers (Tailwind: flex, grid, space-x-*, justify-*, items-*, w-*, h-*, p-*, m-*, etc; Bootstrap: col-*, row, d-flex, etc)
  Prefer semantic class names, roles, data attributes, or element hierarchy for containers

  <css_rules>
  CSS selectors must use semantic attributes and :contains("text") for disambiguation.
  ALLOWED: :contains("text") pseudo class for matching elements by visible text.
  DO NOT use positional pseudo classes in CSS: :nth-of-type, :nth-child, :first, :last, :nth-last-child, :only-child, :only-of-type, :empty, :not, etc.
  </css_rules>

  <xpath_rules>
  XPath locators must start with //.
  XPath should use positional indices [1], [2], [3] and contains(., "text") for disambiguation.
  XPath should rely less on class names — prefer element hierarchy, position, and text content.
  XPath and CSS MUST provide different strategies for finding the same element.
  </xpath_rules>

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
    'a.filter-tab:nth-of-type(1)' // WRONG: positional in CSS, use :contains("Manual") instead
    '//a[contains(@class,"filter-tab") and contains(@class,"active")]' // WRONG: XPath repeats CSS approach, use positional //a[contains(@class,"filter-tab")][1]
    '//table//tbody/tr[1]//button[contains(@onclick,'fn()')]' // onclick is not semantic attribute
    '//html/body/vue-button-123' // vue-framework specific locator
    'link "New Template"'  // WRONG: malformed string, use {"role":"link","text":"New Template"}
    'a[href="/login"]' // WRONG: href changes, use {"role":"link","text":"Login"} instead
    '//a[@href="/settings"]' // WRONG: href-based, use text or ARIA locator
  </bad locator example>

  HTML locators must be valid JS strings
`;

export const uiMapTableFormat = dedent`
  <ui_map_table_format>
  ALWAYS use this exact table format for UI elements:

  | Element | ARIA | CSS | XPath |
  |---------|------|-----|-------|
  | 'Save' | { role: 'button', text: 'Save' } | 'button.save' | '//button[@type="submit"]' |

  Column definitions:
  - Element: Human-readable name of the element
  - ARIA: JSON format { role: '...', text: '...' } - use "text" key, NOT "name"
  - CSS: Unique CSS selector (relative to section container)
  - XPath: Unique XPath selector (relative to section container)

  IMPORTANT: Each section must have a "Section Container CSS Locator" before the table.
  This container is used for disambiguation when clicking elements.

  NEVER use different column layouts. This format is required for all UI maps.
  </ui_map_table_format>
`;

export const sectionUiMapRule = dedent`
  <ui_map_rule>
  List UI elements as a markdown table:
  | Element | ARIA | CSS | XPath |
  | 'Save' | { role: 'button', text: 'Save' } | 'button.save' | '//button[@type="submit"]' |
  | 'Close icon' | { role: 'button', text: 'Close' } | 'button.close-btn' | '//button[@aria-label="Close"]' |
  | 'Menu toggle' | - | 'button.hamburger' | '//button[contains(@class,"hamburger")]' |

  Always include ARIA + CSS + XPath for each element.

  - ARIA: Valid JSON with role and text keys (NOT "name"): { role: 'button', text: 'Save' }
    * For icon buttons: use aria-label or title attribute value as text
    * If no accessible name exists: use "-" and rely on CSS/XPath
    * NEVER use empty text like { role: 'button', text: '' }
  - CSS/XPath: Relative to section container, must be unique within section

  IMPORTANT: Each section must have "Section Container CSS Locator: '...'" before the table.
  This container is critical for disambiguation when interacting with elements.
  </ui_map_rule>
`;

export const screenshotUiMapRule = dedent`
  <ui_map_rule>
  List UI elements as a markdown table WITH Coordinates and Color columns:
  | Element | ARIA | CSS | XPath | Coordinates | Color |
  | 'Save' | { role: 'button', text: 'Save' } | 'button.save' | '//button[@type="submit"]' | (400, 300) | green |
  | 'Delete' | { role: 'button', text: 'Delete' } | 'button.delete' | '//button[@class="delete"]' | (500, 300) | red |
  | 'Close icon' | { role: 'button', text: 'Close' } | 'button.close-btn' | '//button[@aria-label="Close"]' | (500, 100) | - |
  | 'Menu toggle' | - | 'button.hamburger' | '//button[contains(@class,"hamburger")]' | (30, 25) | - |

  - ARIA: Valid JSON with role and text keys (NOT "name"): { role: 'button', text: 'Save' }
    * For icon buttons: use aria-label or title attribute value as text
    * If no accessible name exists: use "-" and rely on CSS/XPath
    * NEVER use empty text like { role: 'button', text: '' }
  - CSS/XPath: Relative to section container, must be unique within section
  - Coordinates: (X, Y) center point when visible on screenshot, "-" when not found
  - Color: accent color ONLY if the element has a distinctive color that differs from the default/majority
    * Use ONLY simple color words: red, green, blue, orange, yellow, purple, gray, white, black
    * NEVER use hex codes (#ff0000), RGB values, or CSS color functions
    * red = danger/delete, green = success/confirm, blue = primary, orange = warning
    * Use "-" when element has no distinctive accent color (same color as other elements)
    * Most elements should be "-" — only highlight elements that stand out visually

  IMPORTANT: Each section must have "Section Container CSS Locator: '...'" before the table.
  CRITICAL: Coordinates and Color columns must be IN the table, NOT in a separate section.
  </ui_map_rule>
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

export const focusedElementRule = dedent`
  <focused_element_actions>
  When a text input element is focused (textbox, combobox, contenteditable):

  To CLEAR the field before typing:
  - I.pressKey(['Meta', 'a']);  // Select all (use 'Control' on Windows/Linux)
  - I.pressKey('Backspace');    // Delete selection

  To TYPE into the focused element:
  - I.type('text to enter');    // Types into currently focused element

  For comboboxes/dropdowns:
  - I.type('search text');      // Filter options by typing
  - I.pressKey('Enter');        // Select highlighted option

  IMPORTANT: type() works WITHOUT a locator when element is already focused.
  If focus is on wrong element, click the correct field first.
  </focused_element_actions>
`;

export const sectionContextRule = dedent`
  <section_context_rule>
  When clicking elements, use the section Context Locator for disambiguation:

  1. Identify which section contains the target element
  2. Get the Context Locator from that section in the UI map

  Use context as second parameter in I.click():
  - I.click('Submit', '.modal-content')  // element in Focus Section
  - I.click({"role":"button","text":"Save"}, '.main')  // element in Main Section
  - I.click('Home', 'nav')  // element in Navigation

  For CSS locators - prepend section context:
  - I.click('.main button.submit')  // instead of I.click('button.submit')
  - I.click('[role="dialog"] .close-btn')  // for modal elements

  This prevents clicking wrong elements when same text/locator appears in multiple sections.
  </section_context_rule>
`;

export const listElementRule = dedent`
  <list_element_indexing>
  When multiple elements share the same structure (e.g., list items, tabs, table rows, menu links):
  Each element MUST have a UNIQUE CSS and XPath selector. CSS and XPath must use DIFFERENT disambiguation strategies:

  CSS — use :contains("text") to disambiguate by visible text content:
    a.filter-tab:contains("Manual"), a.filter-tab:contains("Automated")
    a.node-link:contains("IMR_API_Tests"), a.node-link:contains("IMR_UI_Tests")

  XPath — use positional indices [1], [2], [3] to disambiguate by position:
    //nav//a[contains(@class,"filter-tab")][1], //nav//a[contains(@class,"filter-tab")][2]
    //div[contains(@class,"suites-list")]//a[1], //div[contains(@class,"suites-list")]//a[2]

  This gives two independent strategies: CSS finds by text, XPath finds by position.
  NEVER leave multiple elements with identical CSS or XPath selectors in the same section.
  Every row in the UI map table must have selectors that match exactly ONE element.
  </list_element_indexing>
`;

export function multipleTabsRule(tabs: Array<{ url: string; title: string }>): string {
  const tabsList = tabs.map((tab, i) => `  ${i + 1}. ${tab.title} - ${tab.url}`).join('\n');

  return dedent`
    <multiple_tabs_warning>
    ⚠️ MULTIPLE BROWSER TABS DETECTED!

    Other open tabs:
    ${tabsList}

    You MUST handle these tabs before continuing:

    Option 1 - If the other tab(s) are NOT needed (external docs, popups, etc.):
    \`\`\`js
    I.closeOtherTabs();
    \`\`\`

    Option 2 - If you need content from another tab:
    \`\`\`js
    I.switchToNextTab();      // switch to the next tab
    // ... interact with that tab ...
    I.closeOtherTabs();       // then close other tabs
    \`\`\`

    IMPORTANT: Always close extra tabs to avoid confusion. Multiple tabs can cause test failures.
    </multiple_tabs_warning>
  `;
}

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
  Prefer ARIA locators as the main argument, use CSS/XPath only when ARIA is not available.
  
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
  If nothing works, use I.clickXY(x, y) as last resort.


  ### I.fillField

  fills the field with the given value

  I.fillField(<locator>, <text>)

  <example>
    I.fillField('Username', 'John'); // fills the field located by name or placeholder or label "Username" with the text "John"
    I.fillField('//user/input', 'John'); // fills the field located by XPath "//user/input" with the text "John"
  </example>

  ### I.type

  Types text into the currently focused element. Use when fillField doesn't work,
  for instance, for highly customized input fields like Monaco editors or rich text editors.

  I.type(<text>)

  <example>
    I.type('John'); // types the text "John" into the active element
  </example>

  IMPORTANT: Requires an active/focused input field. Click the field first if not focused.
  DOES NOT receive any locator, just text to type.

  ### I.pressKey

  Sends keyboard key presses to the browser. Use for special keys or key combinations.

  I.pressKey(<key>)
  I.pressKey([<modifier>, <key>])

  <example>
    I.pressKey('Enter');           // Press Enter key
    I.pressKey('Escape');          // Press Escape key
    I.pressKey('Tab');             // Press Tab key
    I.pressKey('Backspace');       // Press Backspace key
    I.pressKey(['Control', 'a']); // Select all (Ctrl+A)
    I.pressKey(['Meta', 'a']);    // Select all on Mac (Cmd+A)
    I.pressKey(['Shift', 'Tab']); // Shift+Tab to go back
    I.pressKey('ArrowDown');      // Navigate dropdown options
  </example>

  IMPORTANT: Requires an active/focused element for most keys.
  Commonly used after I.type() to submit forms or navigate dropdowns.

  ### I.switchTo

  Switches browser context to/from an iframe.

  I.switchTo(<locator>) - switch INTO an iframe
  I.switchTo()          - switch back to MAIN page (exit iframe)

  <example>
    I.switchTo('#payment-iframe'); // Enter iframe
    I.fillField('Card', '4242');   // Interact inside iframe
    I.switchTo();                  // Exit back to main page
  </example>

  IMPORTANT: When inside an iframe, you can only interact with elements inside that iframe.
  Call I.switchTo() without arguments to exit the iframe before interacting with main page elements.

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
