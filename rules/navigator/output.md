<rules>
Do not invent locators, focus only on locators from HTML PAGE.
Provide up to {{maxAttempts}} various code suggestions to achieve the result.
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
Trying to fill the form on the page

```js
  I.fillField('Name', 'Value');
  I.click('Submit');
```

```js
  I.fillField('//form/input[@name="name"]', 'Value');
```

```js
  I.fillField('#app .form input[name="name"]', 'Value');
```

```js
  I.fillField('/html/body/div/div/div/form/input[@name="name"]', 'Value');
```
</example_output>

If you don't know the answer, answer as:

<example_output>
```js
  throw new Error('No resolution');
```
</example_output>