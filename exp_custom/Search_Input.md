---
url: /projects/test-d6178/components/?m=false&s=Search%20Input
title: Testomat.io
summary: Curated search input interaction only.
---
### SUCCEEDED: Drill fill: Search input "Search"

Solution: Clicks the search input and fills it with a search query.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Search"]]//input[@placeholder="Search"]')
I.fillField('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Search"]]//input[@placeholder="Search"]', 'test')
```
