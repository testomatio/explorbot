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

  <context_simplification>
  When container is available from UI map sections:
  - Text + container is simplest and PREFERRED: I.click('Save', '.modal')
  - ARIA + container for disambiguation: I.click({"role":"button","text":"Save"}, '.modal')
  - ALWAYS use context parameter unless locator is XPath or unique ID
  - No need for complex ARIA when container narrows scope sufficiently
  </context_simplification>

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
  - If no accessible name exists, mark ARIA as "-" and use CSS/XPath:
    * CSS: use partial href a[href*="settings"] or SVG icon class a:has(svg.md-icon-cog)
    * XPath: use contains(@href,"settings") or SVG class //a[.//svg[contains(@class,"md-icon-cog")]]
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

  NEVER include \`eidx\` attribute in any locator (ARIA, CSS, XPath). It is an internal annotation.

  If <aria> section is not present or element is not found there, fall back to CSS/XPath locators from <html> section.

  Stick to semantic attributes like role, aria-*, id, class, name, data-id, etc.
  Avoid IDs that follow framework auto-generation patterns (these change on every page load):
  - Ember: #ember123, #ember-basic-dropdown-content-ember456
  - React: #react-select-*, #rc-*
  - Angular: #ng-*, #cdk-*, #mat-*
  - Vue: data-v-* attributes
  Avoid locators that seem to have generated ids or class names (long random numbers, uuids, hashes, etc)
  Prefer text or ARIA locators over href-based ones. But for icon-only links with no accessible name, use:
  - Partial href match: a[href*="settings"], a[href*="requirements"] (use path segments, not full URLs)
  - SVG icon class: a:has(svg.md-icon-cog), button:has(svg.md-icon-plus) (target the SVG class inside the link/button)
  Avoid full absolute href like a[href="/projects/imr_manual12/settings"] — use generic path segments instead
  Avoid CSS framework utility classes as containers (Tailwind: flex, grid, space-x-*, justify-*, items-*, w-*, h-*, p-*, m-*, etc; Bootstrap: col-*, row, d-flex, etc)
  Prefer semantic class names, roles, data attributes, or element hierarchy for containers

  <css_rules>
  CSS selectors must use semantic attributes and :has-text("text") for disambiguation.
  ALLOWED: :has-text("text") pseudo class for matching elements by visible text.
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
    '#content-top form input[name="name"]'
    'a.nav-item[href*="settings"]' // icon-only link matched by partial href
    'a.nav-item:has(svg.md-icon-cog)' // icon-only link matched by SVG icon class
    '//nav//a[contains(@href,"settings")]' // XPath for icon-only nav link
  </good locator example>

  <bad locator example>
    'a.filter-tab:nth-of-type(1)' // WRONG: positional in CSS, use :has-text("Manual") instead
    '//a[contains(@class,"filter-tab") and contains(@class,"active")]' // WRONG: XPath repeats CSS approach, use positional //a[contains(@class,"filter-tab")][1]
    '//table//tbody/tr[1]//button[contains(@onclick,'fn()')]' // onclick is not semantic attribute
    '//html/body/vue-button-123' // vue-framework specific locator
    'link "New Template"'  // WRONG: malformed string, use {"role":"link","text":"New Template"}
    'a[href="/projects/imr_manual12/settings"]' // WRONG: full absolute href, use a[href*="settings"] instead
  </bad locator example>

  HTML locators must be valid JS strings
`;

export const uiMapTableFormat = dedent`
  <ui_map_table_format>
  ALWAYS use this exact table format for UI elements:

  | Element | ARIA | CSS | eidx |
  |---------|------|-----|------|
  | 'Save' | { role: 'button', text: 'Save' } | 'button.save' | 5 |

  Column definitions:
  - Element: Human-readable name of the element
  - ARIA: JSON format { role: '...', text: '...' } - use "text" key, NOT "name"
  - CSS: Unique CSS selector (relative to section container)
  - eidx: Value of the eidx attribute from the HTML element. Use "-" if not present.

  IMPORTANT: Each section must have a blockquote container before the table: > Container: '.css-selector'
  This container is used for disambiguation when clicking elements.

  NEVER use different column layouts. This format is required for all UI maps.
  </ui_map_table_format>
`;

export const sectionUiMapRule = dedent`
  <ui_map_rule>
  List UI elements as a markdown table:
  | Element | ARIA | CSS |
  | 'Save' | { role: 'button', text: 'Save' } | 'button.save' |
  | 'Close icon' | { role: 'button', text: 'Close' } | 'button.close-btn' |
  | 'Menu toggle' | - | 'button.hamburger' |

  Always include ARIA + CSS for each element.

  - ARIA: Valid JSON with role and text keys (NOT "name"): { role: 'button', text: 'Save' }
    * For icon buttons: use aria-label or title attribute value as text
    * If no accessible name exists: use "-" and rely on CSS
    * NEVER use empty text like { role: 'button', text: '' }
  - CSS: Relative to section container, must be unique within section

  IMPORTANT: Each section must have a blockquote container before the table: > Container: '.css-selector'
  This container is critical for disambiguation when interacting with elements.
  </ui_map_rule>
`;

export const screenshotUiMapRule = dedent`
  <ui_map_rule>
  List UI elements as a markdown table WITH Coordinates, Color, and Icon columns:
  | Element | ARIA | CSS | Coordinates | Color | Icon |
  | 'Save' | { role: 'button', text: 'Save' } | 'button.save' | (400, 300) | green | - |
  | 'Delete' | { role: 'button', text: 'Delete' } | 'button.delete' | (500, 300) | red | trash |
  | 'Settings dropdown' | { role: 'button', text: 'Settings' } | 'button.settings' | (500, 100) | - | down-chevron |
  | 'Menu toggle' | - | 'button.hamburger' | (30, 25) | - | hamburger |
  | 'Add item' | { role: 'button', text: 'Add' } | 'button.add' | (200, 50) | blue | plus |
  | 'Close' | { role: 'button', text: 'Close' } | 'button.close' | (600, 10) | - | x |

  - ARIA: Valid JSON with role and text keys (NOT "name"): { role: 'button', text: 'Save' }
    * For icon buttons: use aria-label or title attribute value as text
    * If no accessible name exists: use "-" and rely on CSS
    * NEVER use empty text like { role: 'button', text: '' }
  - CSS: Relative to section container, must be unique within section
  - Coordinates: (X, Y) center point when visible on screenshot, "-" when not found
  - Color: accent color ONLY if the element has a distinctive color that differs from the default/majority
    * Use ONLY simple color words: red, green, blue, orange, yellow, purple, gray, white, black
    * NEVER use hex codes (#ff0000), RGB values, or CSS color functions
    * red = danger/delete, green = success/confirm, blue = primary, orange = warning
    * Use "-" when element has no distinctive accent color (same color as other elements)
    * Most elements should be "-" — only highlight elements that stand out visually
  - Icon: one-word description of the visual icon on the element, "-" if no icon
    * For directional icons use direction + shape: down-chevron, down-arrow, right-caret, up-arrow
    * Common icons: plus, x, trash, pencil, gear, search, hamburger, ellipsis, star, check, filter
    * Use "-" for text-only elements with no icon

  IMPORTANT: Each section must have a blockquote container before the table: > Container: '.css-selector'
  CRITICAL: Coordinates, Color, and Icon columns must be IN the table, NOT in a separate section.
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

  When container is available, text + container is simplest and preferred over complex locators.

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

export const fileUploadRule = dedent`
  <file_upload>
  Explorbot CAN upload files using I.attachFile() via form() tool.
  When a test scenario involves file uploading, use the available sample files listed in <available_files>.
  Use I.attachFile(locator, filePath) where locator points to an input[type="file"] element.
  For drag-and-drop upload zones, look for a hidden input[type="file"] inside the dropzone container.
  </file_upload>
`;

// in rage mode we do not protect from irreversible actions
export const protectionRule = dedent`
  <important>
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
  Context parameter is DEFAULT for all interactions. ALWAYS use container from UI map sections unless locator is XPath or unique ID.

  1. Identify which section contains the target element
  2. Get the Context Locator from that section in the UI map
  3. Pass container as the last parameter

  Context works with ALL interaction methods:
  - I.click('Submit', '.modal-content')
  - I.click({"role":"button","text":"Save"}, '.main')
  - I.fillField('Username', 'admin', '.login-form')
  - I.selectOption('Country', 'USA', '.address-section')
  - I.attachFile('input[type="file"]', '/path/file', '.upload-section')
  - I.seeInField('Email', 'john@example.com', '.profile-form')
  - I.dontSeeInField('Password', '', '.login-form')

  For CSS locators - prepend section context:
  - I.click('.main button.submit')  // instead of I.click('button.submit')

  Only omit context when:
  - Locator is XPath (already includes path context)
  - Locator is a unique ID (#specific-element)
  </section_context_rule>

  <unexpected_popup_rule>
  If a modal/popup appeared that you didn't expect, dismiss it first before continuing with original task.
  If elements become hidden or unclickable (timeout errors on visible elements), a dialog or overlay may have appeared on top.
  If buttons are disabled unexpectedly, check if a popup is blocking interaction or if required form fields are empty.

  Dismiss strategy (try in order):
  1. I.clickXY(0, 0) — click outside the popup to close it
  2. I.pressKey('Escape') — press Escape to dismiss
  3. I.click('Cancel') — click Cancel button if present
  4. I.click({ role: 'button', text: 'Close' }) — click X/close button if present
  </unexpected_popup_rule>
`;

export const listElementRule = dedent`
  <list_element_indexing>
  When multiple elements share the same structure (e.g., list items, tabs, table rows, menu links):
  Each element MUST have a UNIQUE CSS selector.

  CSS — use :has-text("text") to disambiguate by visible text content:
    a.filter-tab:has-text("Manual"), a.filter-tab:has-text("Automated")
    a.node-link:has-text("IMR_API_Tests"), a.node-link:has-text("IMR_UI_Tests")

  NEVER leave multiple elements with identical CSS selectors in the same section.
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

  I.fillField(<locator>, <text>, <context>)

  <example>
    I.fillField('Username', 'John', '.login-form'); // fills Username inside .login-form
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
  NEVER write: I.type('text', locator) or I.type('text', {locator: '...'}) — this is INVALID.
  To type into a specific field: use I.fillField(locator, text) or I.click(locator) then I.type(text).

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

  I.selectOption(<locator>, <value>, <context>)

  <example>
    I.selectOption('Choose Plan', 'Monthly', '.billing-section'); // select inside section
    I.selectOption('Choose Plan', 'Monthly'); // select by label
    I.selectOption('subscription', 'Monthly'); // match option by text
    I.selectOption('//form/select[@name=account]','Premium');
    I.selectOption('form select[name=account]', 'Premium');
  </example>

  ### I.attachFile

  Attaches a file to a file input element.

  I.attachFile(<locator>, <filePath>, <context>)

  <example>
    I.attachFile('input[type="file"]', '/absolute/path/to/sample.png', '.upload-section')
    I.attachFile('input[type="file"]', '/absolute/path/to/sample.png')
    I.attachFile('#file-upload', '/absolute/path/to/sample.pdf')
  </example>

  IMPORTANT: Only works with input[type="file"] elements.
  The locator must point to a file input or a label associated with one.
  For drag-and-drop upload zones, look for a hidden input[type="file"] inside the dropzone container.
  Use the file paths from <available_files> section.

  ### I.moveCursorTo

  Moves the mouse cursor to an element, triggering hover effects. Does NOT click.
  Use to discover hover-triggered UI: tooltips, popovers, dropdown menus, preview cards.

  I.moveCursorTo(<locator>, <context>)

  <example>
    I.moveCursorTo('Settings');
    I.moveCursorTo({ role: 'menuitem', text: 'Products' }, '.navigation');
    I.moveCursorTo('.user-avatar');
  </example>

  After hovering, use see() or context() to check what appeared.

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

  ### I.seeInField

  I.seeInField(<locator>, <value>, <context>)

  Checks that an input field contains the expected value.
  Use for verifying text inputs, search fields, textareas, and any form field values.
  This is the ONLY reliable way to check input values — do NOT use I.seeElement with [value=...] or I.seeInSource.

  <example>
    I.seeInField('Email', 'john@example.com', '.profile-form');
    I.seeInField('Search', 'nightwatch');
    I.seeInField('input[name="search"]', 'test query');
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

  ### I.dontSeeInField

  I.dontSeeInField(<locator>, <value>, <context>)

  Checks that an input field does NOT contain the specified value.

  <example>
    I.dontSeeInField('Password', '', '.login-form');
    I.dontSeeInField('Search', 'old query');
    I.dontSeeInField('Email', '');
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
  For input field values, ALWAYS use I.seeInField() — never check value via CSS attribute selectors or I.seeInSource.
  Prefer text locators (label, name, placeholder) for form fields: I.seeInField('Search', 'value') over I.seeInField('input[name="search"]', 'value').
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
