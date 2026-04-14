---
url: /projects/test-d6178/components/?s=Legacy
title: Testomat.io
summary: Curated legacy dropdown trigger interactions only.
---
### SUCCEEDED: Drill click: Passed 1 legacy status dropdown

Solution: Clicks the Passed 1 legacy status dropdown trigger and opens its dropdown.

```javascript
I.click("//*[self::div and contains(@class,\"secondary-btn\") and contains(@class,\"btn-sm\") and normalize-space(.)=\"Passed 1\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Failed 2 legacy status dropdown

Solution: Clicks the Failed 2 legacy status dropdown trigger and opens its dropdown.

```javascript
I.click("//*[self::div and contains(@class,\"secondary-btn\") and contains(@class,\"btn-sm\") and normalize-space(.)=\"Failed 2\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Skipped 3 legacy status dropdown

Solution: Clicks the Skipped 3 legacy status dropdown trigger and opens its dropdown.

```javascript
I.click("//*[self::div and contains(@class,\"secondary-btn\") and contains(@class,\"btn-sm\") and normalize-space(.)=\"Skipped 3\" and not(.//svg)]")
```
