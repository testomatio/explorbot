---
url: /projects/test-d6178/components/?m=false&s=Form%20Elements
title: Testomat.io
summary: Curated form element interactions only.
---
### SUCCEEDED: Drill click: Toggle off switch

Solution: Clicks the Toggle - off switch and toggles it to the on state.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Toggle - off"]]//button[@role="switch" and not(contains(@class,"cursor-not-allowed"))]')
```


### SUCCEEDED: Drill click: Toggle on switch

Solution: Clicks the Toggle - on switch and toggles it to the off state.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Toggle - on"]]//button[@role="switch" and not(contains(@class,"cursor-not-allowed"))]')
```


### SUCCEEDED: Drill select date range: DateRange textbox

Solution: Clicks the DateRange input, opens the date picker, and selects a date range.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="DateRange"]]//input[@placeholder="Select date range"]');
I.click('span.flatpickr-day[aria-label="April 12, 2026"]');
I.click('span.flatpickr-day[aria-label="April 13, 2026"]');
```
