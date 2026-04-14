---
url: /projects/test-d6178/components/?m=false&s=Input%20With%20Tags
title: Testomat.io
summary: Curated input with tags interaction only.
---
### SUCCEEDED: Drill addTag: Tags input "Type @ to add tags"

Solution: Clicks the tag combobox, enters a tag value, and confirms it with Enter.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Input With Tags"]]//input[@placeholder="Type @ to add tags"]');
I.fillField('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Input With Tags"]]//input[@placeholder="Type @ to add tags"]', '@foo');
I.pressKey('Enter');
```
