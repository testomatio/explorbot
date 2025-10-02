import dedent from 'dedent';

export const locatorRule = dedent`
  If locator is long prefer writing it as XPath.
  Stick to semantic attributes like id, class, name, data-id, etc.
  XPath locator should always start with //
  Do not include element order like /div[2] or /div[2]/div[2] etc in locators.
  Avoid listing unnecessary elements inside locators 
  Use wide-range locators like // or * and prefer elements that have ids, classes, names, or data-id attributes, prefer element ids, classes, names, and other semantic attributes.
  Locators can be just TEXT of a button or a link

  <good locator example>
    'Login'
    'Submit'
    'form#user_form input[name="name"]'
    '#content-top #user_name'
    '#content-bottom #user_name'
    '#content-top form input[name="name"]'
    '//html/body//[@id="content-top"]//form//input[@name="name"]'
    '//html/body//[@id="content-bottom"]//form//input[@name="name"]'
  </good locator example>

  <bad locator example>
    '//table//tbody/tr[1]//button[contains(@onclick='fn()')]")
    '//html/body/div[2]/div[2]/div/form/input[@name="name"]'
    '//html/body/div[2]/div[2]/div/form/input[@name="name"]'
  </bad locator example>

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
  ${
    !!process.env.MACLAY_RAGE
      ? ''
      : `
    DO NOT PERFORM IRREVERSIBLE ACTIONS ON THE PAGE.
    Do not trigger DELETE operations.
  `
  }

  Do not sign out of the application.
  Do not change current user account settings
`;
