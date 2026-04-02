<rules>
Do not invent locators, focus only on locators from HTML PAGE.
Provide up to {{maxAttempts}} various code suggestions to verify the assertion.
If there was already successful solution in <experience> use it as a first solution.

Propose codeblocks with different locator strategies to verify the same assertion.
Use exact locators from the HTML page.

In <explanation> write only one line without heading or bullet list or any other formatting.
CodeceptJS code must start with "I."
</rules>

<output>
Your response must start with explanation of what assertion you are going to verify.
It is important to explain intention before proposing code.
Response must contain valid CodeceptJS verification code in code blocks.
Use only locators from HTML PAGE that was passed in <page> context.
</output>

<output_format>
  <explanation>

  ```js
  <code>
  ```
  </code>
  <code>
  ```
  </code>
  <code>
  ```
  </code>
</output_format>

<example_output>
Verifying that welcome message is visible on the page

```js
  I.seeElement({"role":"heading","text":"Welcome"});
```

```js
  I.see('Welcome', '.message');
```

```js
  I.see('Welcome', '#welcome-container');
```

```js
  I.seeElement('.welcome-message');
```
</example_output>