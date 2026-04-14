---
url: /projects/test-d6178/components/?m=false&s=New%20counter
title: Testomat.io
summary: Curated counter button interactions only.
---
### SUCCEEDED: Drill click: Counter in third button large icon counter

Solution: Clicks the third large icon-counter button with value 7.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"icon-counter\") and normalize-space(.)=\"7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in secondary button large icon counter

Solution: Clicks the secondary large icon-counter button with value 7.

```javascript
I.click("//*[self::button and contains(@class,\"secondary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"icon-counter\") and normalize-space(.)=\"7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in third button extra large Pending

Solution: Clicks the third extra large Pending counter button with value 7.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-xl\") and normalize-space(.)=\"Pending\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in third button medium Failed

Solution: Clicks the third medium Failed counter button with value 7.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and normalize-space(.)=\"Failed\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in third button small Passed

Solution: Clicks the third small Passed counter button; the counter increments from 7.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and normalize-space(.)=\"Passed\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in secondary button extra large Pending

Solution: Clicks the secondary extra large Pending counter button with value 7.

```javascript
I.click("//*[self::button and contains(@class,\"secondary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-xl\") and normalize-space(.)=\"Pending\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in secondary button medium Failed

Solution: Clicks the secondary medium Failed counter button with value 7.

```javascript
I.click("//*[self::button and contains(@class,\"secondary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and normalize-space(.)=\"Failed\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in secondary button small Passed

Solution: Clicks the secondary small Passed counter button; the counter increments from 7.

```javascript
I.click("//*[self::button and contains(@class,\"secondary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and normalize-space(.)=\"Passed\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in third button large selected

Solution: Clicks the selected third large counter button and toggles its selected state.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-selected\") and normalize-space(.)=\"Button text\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in secondary button large selected

Solution: Clicks the selected secondary large counter button and toggles its selected state.

```javascript
I.click("//*[self::button and contains(@class,\"secondary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-selected\") and normalize-space(.)=\"Button text\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in third button large Pending dropdown

Solution: Clicks the third large Pending counter button and opens its dropdown.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-icon-after\") and normalize-space(.)=\"Pending\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in third button large Skipped dropdown

Solution: Clicks the third large Skipped counter button and opens its dropdown.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-icon-after\") and normalize-space(.)=\"Skipped\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in secondary button large Pending dropdown

Solution: Clicks the secondary large Pending counter button and opens its dropdown.

```javascript
I.click("//*[self::button and contains(@class,\"secondary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-icon-after\") and normalize-space(.)=\"Pending\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in secondary button large Skipped dropdown

Solution: Clicks the secondary large Skipped counter button and opens its dropdown.

```javascript
I.click("//*[self::button and contains(@class,\"secondary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-icon-after\") and normalize-space(.)=\"Skipped\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in third button large Failed with icon

Solution: Clicks the third large Failed counter button with icon.

```javascript
I.click("button.third-btn.btn-text-and-icon.btn-lg:has-text(\"Failed\\n              \\n  \\n                7\"):has(svg)")
```


### SUCCEEDED: Drill click: Counter in secondary button large Failed with icon

Solution: Clicks the secondary large Failed counter button with icon.

```javascript
I.click("//*[self::button and contains(@class,\"secondary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and normalize-space(.)=\"Failed\n              \n  \n                7\" and .//svg]")
```


### SUCCEEDED: Drill click: Counter in third button large Passed

Solution: Clicks the third large Passed counter button with value 7.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and normalize-space(.)=\"Passed\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in third button large Skipped

Solution: Clicks the third large Skipped counter button with value 7.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and normalize-space(.)=\"Skipped\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in secondary button large Failed

Solution: Clicks the secondary large Failed counter button with value 7.

```javascript
I.click("//*[self::button and contains(@class,\"secondary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and normalize-space(.)=\"Failed\n              \n  \n                7\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Counter in secondary button large Passed

Solution: Clicks the secondary large Passed counter button; the counter increments from 7.

```javascript
I.click("//*[self::button and contains(@class,\"secondary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and normalize-space(.)=\"Passed\n              \n  \n                7\" and not(.//svg)]")
```
