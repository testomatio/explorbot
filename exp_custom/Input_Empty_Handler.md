---
url: /projects/test-d6178/components/?s=Input%20Empty%20Handler
title: Testomat.io
summary: Curated input empty handler interaction only.
---
### SUCCEEDED: Drill click: Title input "Enter title"

Solution: Clicks the title input and focuses it.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Title"]]//input[@placeholder="Enter title"]')
```
