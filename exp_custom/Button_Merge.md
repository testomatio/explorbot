---
url: /projects/test-d6178/components/?m=false&s=Button%3A%3AMerge
title: Testomat.io
summary: Curated merge button interactions only.
---
### SUCCEEDED: Drill click: Merge button small

Solution: Clicks the small Merge dropdown button and opens dropdown menu.

```javascript
I.click("//*[self::div and contains(@class,\"merge-btn\") and contains(@class,\"btn-icon-after\") and contains(@class,\"btn-sm\") and normalize-space(.)=\"Merge\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Merge button medium

Solution: Clicks the medium Merge dropdown button and opens dropdown menu.

```javascript
I.click("//*[self::div and contains(@class,\"merge-btn\") and contains(@class,\"btn-icon-after\") and contains(@class,\"btn-md\") and normalize-space(.)=\"Merge\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Merge button large

Solution: Clicks the large Merge dropdown button and opens dropdown menu.

```javascript
I.click("//*[self::div and contains(@class,\"merge-btn\") and contains(@class,\"btn-icon-after\") and contains(@class,\"btn-lg\") and normalize-space(.)=\"Merge\" and not(.//svg)]")
```
