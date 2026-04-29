import dedent from 'dedent';

export const recommendedCodeceptCommands = ['I.click', 'I.type', 'I.fillField', 'I.see', 'I.seeElement'] as const;

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

export const fileUploadRule = dedent`
  <file_upload>
  Explorbot CAN upload files using I.attachFile() via form() tool.
  When a test scenario involves file uploading, use the available sample files listed in <available_files>.
  Use I.attachFile(locator, filePath) where locator points to an input[type="file"] element.
  Works with drag-and-drop upload zones.
  </file_upload>
`;

// in rage mode we do not protect from irreversible actions
export const protectionRule = dedent`
  <important>
  Do not sign out current user of the application.
  Do not change current user account settings.

  Pre-existing data on the page belongs to the application, not the test.
  Items that were not created inside the current test scenario must not be deleted, removed, emptied, reset, archived, or otherwise destroyed.
  If a scenario needs to verify destructive behaviour, the same scenario must first create a disposable target and then destroy that specific target — never operate on data that was already there when the test started.

  The resource that the current page URL represents is "under test".
  The test must not destroy the resource it is running against — doing so invalidates every subsequent scenario that starts on the same URL.
  Do not propose or perform delete/remove/archive actions on the entity that owns the current URL; propose such actions only on disposable children created within the scenario itself.
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

export const unexpectedPopupRule = dedent`
  <unexpected_popup_rule>
  If a modal/popup appeared that you didn't expect, dismiss it first before continuing with original task.
  If elements become hidden or unclickable (timeout errors on visible elements), a dialog or overlay may have appeared on top.
  If a click error mentions "intercepts pointer events", another element is covering the target — dismiss it first.
  If buttons are disabled unexpectedly, check if a popup is blocking interaction or if required form fields are empty.

  Dismiss strategy (try in order):
  1. I.clickXY(0, 0) — click outside the popup to close it
  2. I.pressKey('Escape') — press Escape to dismiss
  3. I.click('Cancel') — click Cancel button if present
  4. I.click({ role: 'button', text: 'Close' }) — click X/close button if present
  </unexpected_popup_rule>
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
  - I.attachFile('input[type="file"]', 'path/to/file', '.upload-section')
  - I.seeInField('Email', 'john@example.com', '.profile-form')
  - I.dontSeeInField('Password', '', '.login-form')

  For CSS locators - prepend section context:
  - I.click('.main button.submit')  // instead of I.click('button.submit')

  Only omit context when:
  - Locator is XPath (already includes path context)
  - Locator is a unique ID (#specific-element)
  </section_context_rule>

  ${unexpectedPopupRule}
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
    I.fillField('Description', 'Hello world', '.editor'); // works for rich text / code editors too
  </example>

  I.fillField handles plain inputs, textareas, contenteditable regions, and rich text / code editors
  (Monaco, ProseMirror, CodeMirror, TipTap, Quill, Draft.js, Slate, etc.) transparently.
  ALWAYS use I.fillField for rich editors — target the editor container or its nearest label/heading with a normal locator.
  Do NOT open the editor with raw JS (executeScript, page.evaluate), do NOT dispatch synthetic events,
  do NOT call the editor's own API (monaco.editor.setValue, view.dispatch, etc.) to write text.

  ### I.type

  Types text into the currently focused element. Use only when there is no locator you can pass to I.fillField —
  e.g. the target is implicit (a just-opened command palette, an autocomplete that steals focus, a canvas-based surface).

  I.type(<text>)

  <example>
    I.type('John'); // types the text "John" into the active element
  </example>

  IMPORTANT: Requires an active/focused input field. Click the field first if not focused.
  DOES NOT receive any locator, just text to type.
  NEVER write: I.type('text', locator) or I.type('text', {locator: '...'}) — this is INVALID.
  To type into a specific field: use I.fillField(locator, text) or I.click(locator) then I.type(text).
  Do NOT reach for I.type just because the target looks like a rich editor — I.fillField handles those.

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
  Commonly used after I.type() or I.fillField() to submit forms or navigate dropdowns.

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
    I.attachFile('input[type="file"]', 'path/to/sample.png', '.upload-section')
    I.attachFile('input[type="file"]', 'path/to/sample.png')
    I.attachFile('#file-upload', 'path/to/sample.pdf')
  </example>

  IMPORTANT: Only works with input[type="file"] elements.
  The locator must point to a file input or a label associated with one.
  Use file paths exactly as listed in <available_files>.
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
