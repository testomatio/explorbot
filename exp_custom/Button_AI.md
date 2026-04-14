---
url: /projects/test-d6178/components/?m=false&s=AI%3A%3AButton
title: Testomat.io
summary: Curated AI button interactions only.
---
### SUCCEEDED: Drill click: AI button size mini icon only

Solution: Clicks the mini icon-only AI button and opens the AI modal.

```javascript
I.click("button.ai-btn.btn-only-icon.btn-mini:has(svg)")
```


### SUCCEEDED: Drill click: AI button size mini icon only selected

Solution: Clicks the selected mini icon-only AI button, opens the AI modal, and toggles selected state.

```javascript
I.click("button.ai-btn.btn-only-icon.btn-mini.btn-selected:has(svg)")
```


### SUCCEEDED: Drill click: AI button size small icon only

Solution: Clicks the small icon-only AI button and opens the AI modal.

```javascript
I.click("button.ai-btn.btn-only-icon.btn-sm:has(svg)")
```


### SUCCEEDED: Drill click: AI button size small Default AI leading icon

Solution: Clicks the small Default AI button with a leading icon and opens the AI modal.

```javascript
I.click("//*[self::button and contains(@class,\"ai-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(normalize-space(.),\"Default AI\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: AI button size small Default AI leading and trailing icons

Solution: Clicks the small Default AI button with leading and trailing icons and opens the AI modal/dropdown action.

```javascript
I.click("//*[self::button and contains(@class,\"ai-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Default AI\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: AI button size small Default AI selected

Solution: Clicks the selected small Default AI dropdown-style button, opens the AI modal, and toggles selected state.

```javascript
I.click("//*[self::button and contains(@class,\"ai-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(@class,\"btn-icon-after\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Default AI\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: AI button size medium icon only

Solution: Clicks the medium icon-only AI button and opens the AI modal.

```javascript
I.click("button.ai-btn.btn-only-icon.btn-md:has(svg)")
```


### SUCCEEDED: Drill click: AI button size medium Default AI leading icon

Solution: Clicks the medium Default AI button with a leading icon and opens the AI modal.

```javascript
I.click("//*[self::button and contains(@class,\"ai-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(normalize-space(.),\"Default AI\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: AI button size medium Default AI leading and trailing icons

Solution: Clicks the medium Default AI button with leading and trailing icons and opens the AI modal/dropdown menu.

```javascript
I.click("//*[self::button and contains(@class,\"ai-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Default AI\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: AI button size medium Default AI selected

Solution: Clicks the selected medium Default AI dropdown-style button, opens the AI modal, and toggles selected state.

```javascript
I.click("//*[self::button and contains(@class,\"ai-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(@class,\"btn-icon-after\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Default AI\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: AI button size large icon only

Solution: Clicks the large icon-only AI button and opens the AI feature modal.

```javascript
I.click("button.ai-btn.btn-only-icon.btn-lg:has(svg)")
```


### SUCCEEDED: Drill click: AI button size large embedded text leading icon

Solution: Clicks the large embedded-text AI button and opens the AI feature modal.

```javascript
I.click("//*[self::button and contains(@class,\"ai-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(normalize-space(.),\"embedded text\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: AI button size large Default AI leading icon

Solution: Clicks the large Default AI button with a leading icon and opens the AI modal.

```javascript
I.click("//*[self::button and contains(@class,\"ai-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(normalize-space(.),\"Default AI\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: AI button size large Default AI leading and trailing icons

Solution: Clicks the large Default AI button with leading and trailing icons and opens the AI modal/dropdown menu.

```javascript
I.click("//*[self::button and contains(@class,\"ai-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Default AI\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: AI button size large Default AI selected

Solution: Clicks the selected large Default AI dropdown-style button, opens the AI modal, and toggles selected state.

```javascript
I.click("//*[self::button and contains(@class,\"ai-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-icon-after\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Default AI\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: AI button with select dropdown

Solution: Clicks the left side of the AI split button to open the AI modal; clicking the right side opens the dropdown.

```javascript
I.click("//*[self::button and contains(@class,\"ai-btn\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-dropdown\") and contains(normalize-space(.),\"AI btn + select\")]")
```
