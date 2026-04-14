---
url: /projects/test-d6178/components/?m=false&s=Button%3A%3ARed
title: Testomat.io
summary: Curated red button interactions only.
---
### SUCCEEDED: Drill click: Red button size small plain text

Solution: Clicks the small red text button without icons.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and not(.//svg)]")
```


### SUCCEEDED: Drill click: Red button size small leading icon

Solution: Clicks the small red text button with a leading icon.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Red button size small trailing icon

Solution: Clicks the small red text button with a trailing chevron icon.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)=1]")
```


### SUCCEEDED: Drill click: Red button size small leading and trailing icons

Solution: Clicks the small red text button with both leading and trailing icons.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: Red button size small icon only

Solution: Clicks the small red icon-only button.

```javascript
I.click("button.red-btn.btn-only-icon.btn-sm:has(svg)")
```


### SUCCEEDED: Drill click: Red button size small selected

Solution: Toggles the selected state of the small red selected button.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Button selected\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Red button size medium plain text

Solution: Clicks the medium red text button without icons.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and not(.//svg)]")
```


### SUCCEEDED: Drill click: Red button size medium leading icon

Solution: Clicks the medium red text button with a leading icon.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Red button size medium trailing icon

Solution: Clicks the medium red text button with a trailing chevron icon.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)=1]")
```


### SUCCEEDED: Drill click: Red button size medium leading and trailing icons

Solution: Clicks the medium red text button with both leading and trailing icons.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: Red button size medium icon only

Solution: Clicks the medium red icon-only button.

```javascript
I.click("button.red-btn.btn-only-icon.btn-md:has(svg)")
```


### SUCCEEDED: Drill click: Red button size medium selected

Solution: Toggles the selected state of the medium red selected button.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Button selected\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Red button size large plain text

Solution: Clicks the large red text button without icons.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and not(.//svg)]")
```


### SUCCEEDED: Drill click: Red button size large leading icon

Solution: Clicks the large red text button with a leading icon.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Red button size large trailing icon

Solution: Clicks the large red text button with a trailing chevron icon.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)=1]")
```


### SUCCEEDED: Drill click: Red button size large leading and trailing icons

Solution: Clicks the large red text button with both leading and trailing icons.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: Red button size large icon only

Solution: Clicks the large red icon-only button.

```javascript
I.click("button.red-btn.btn-only-icon.btn-lg:has(svg)")
```


### SUCCEEDED: Drill click: Red button size large two icons only

Solution: Clicks the large red button that contains two icons and no text.

```javascript
I.click("button.red-btn.btn-only-two-icons.btn-lg.btn-icon-after")
```


### SUCCEEDED: Drill click: Red button size large selected

Solution: Toggles the selected state of the large red selected button.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Button selected\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Red button size extra large plain text

Solution: Clicks the extra large red text button without icons.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-xl\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and not(.//svg)]")
```


### SUCCEEDED: Drill click: Red button size extra large leading icon

Solution: Clicks the extra large red text button with a leading icon.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-xl\") and contains(normalize-space(.),\"Button text\") and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Red button size extra large icon only

Solution: Clicks the extra large red icon-only button.

```javascript
I.click("button.red-btn.btn-only-icon.btn-xl:has(svg)")
```


### SUCCEEDED: Drill click: Red button size extra large selected

Solution: Toggles the selected state of the extra large red selected button.

```javascript
I.click("//*[self::button and contains(@class,\"red-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-xl\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Button selected\") and not(.//svg)]")
```
