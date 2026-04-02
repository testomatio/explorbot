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