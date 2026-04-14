---
url: /projects/test-d6178/components/?m=false&s=Other%20buttons
title: Testomat.io
summary: Curated other button interactions only.
---
### SUCCEEDED: Drill click: Template button Use Template

Solution: Clicks the Use Template button and opens the templates dropdown menu.

```javascript
I.click("//*[self::button and contains(@class,\"secondary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(@class,\"btn-icon-after\") and contains(@class,\"truncate\") and normalize-space(.)=\"Use Template\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Substatus button Passed

Solution: Clicks the Passed substatus button and keeps the selected substatus state active.

```javascript
I.click("//*[self::button and contains(@class,\"substatus\") and contains(@class,\"passed\") and contains(@class,\"selected\") and normalize-space(.)=\"Passed\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Substatus button Skipped

Solution: Clicks the Skipped substatus button and keeps the selected substatus state active.

```javascript
I.click("//*[self::button and contains(@class,\"substatus\") and contains(@class,\"skipped\") and contains(@class,\"selected\") and normalize-space(.)=\"Skipped\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Substatus button Failed

Solution: Clicks the Failed substatus button and keeps the selected substatus state active.

```javascript
I.click("//*[self::button and contains(@class,\"substatus\") and contains(@class,\"failed\") and contains(@class,\"selected\") and normalize-space(.)=\"Failed\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Substatus button Click me

Solution: Clicks the Click me substatus action button and opens its loading spinner after click.

```javascript
I.click("button.substatus.click:has-text(\"Click me\"):has(svg):not(:has(svg + svg))")
```


### SUCCEEDED: Drill click: Lang button beautify

Solution: Clicks the small beautify language button.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and normalize-space(.)=\"beautify\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Async button Click Me

Solution: Clicks the async Click Me button and starts its loading state.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-md\") and contains(@class,\"btn-text-and-icon\") and normalize-space(.)=\"Click Me\" and not(.//svg)]")
```
