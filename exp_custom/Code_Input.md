---
url: /projects/test-d6178/components/?m=false&s=Code%20Input
title: Testomat.io
summary: Curated code input editor interaction only.
---
### SUCCEEDED: Drill type code: Code editor

Solution: Switches into the code editor iframe, clicks the Monaco editor, types example code, and returns to the main page.

```javascript
I.switchTo("(//iframe[contains(@src,\"/ember-monaco/frame.html\")])[1]");
I.click(".monaco-editor");
I.type("const value = \"test\";");
I.switchTo();
```
