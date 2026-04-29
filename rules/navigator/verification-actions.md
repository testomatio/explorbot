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
NEVER use `:has-text(...)` inside a seeElement/dontSeeElement locator. Checking text inside an element is the job of I.see(text, context) — the `:has-text()` form duplicates that capability with a fragile selector.
NEVER emit two assertions that check the same fact with different shapes. `I.see(text, locator)` and `I.seeElement("<locator>:has-text('text')")` verify the same thing — pick one (prefer I.see). One claim, one assertion.
</verification_rules>

[DO NEVER USE OTHER CODECEPTJS COMMANDS THAN PROPOSED HERE]
[INTERACT ONLY WITH ELEMENTS THAT ARE ON THE PAGE HTML OR ARIA SNAPSHOT]
[DO NOT USE WAIT FUNCTIONS]

</actions>