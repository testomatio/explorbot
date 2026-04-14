---
url: /projects/test-d6178/components/?m=false&s=Button%3A%3APrimary
title: Testomat.io
summary: Curated primary button interactions only.
---
### SUCCEEDED: Drill click: Primary button size small plain text

Solution: Clicks the small primary text button without icons.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and not(.//svg)]")
```


### SUCCEEDED: Drill click: Primary button size small leading icon

Solution: Clicks the small primary text button with a leading icon.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Primary button size small trailing icon

Solution: Clicks the small primary text button with a trailing chevron icon.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)=1]")
```


### SUCCEEDED: Drill click: Primary button size small leading and trailing icons

Solution: Clicks the small primary text button with both leading and trailing icons.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: Primary button size small icon only

Solution: Clicks the small primary icon-only button.

```javascript
I.click("button.primary-btn.btn-only-icon.btn-sm:has(svg)")
```


### SUCCEEDED: Drill click: Primary button size small selected

Solution: Toggles the selected state of the small primary selected button.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Button selected\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Primary button size medium plain text

Solution: Clicks the medium primary text button without icons.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and not(.//svg)]")
```


### SUCCEEDED: Drill click: Primary button size medium leading icon

Solution: Clicks the medium primary text button with a leading icon.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Primary button size medium trailing icon

Solution: Clicks the medium primary text button with a trailing chevron icon.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)=1]")
```


### SUCCEEDED: Drill click: Primary button size medium leading and trailing icons

Solution: Clicks the medium primary text button with both leading and trailing icons.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: Primary button size medium icon only

Solution: Clicks the medium primary icon-only button.

```javascript
I.click("button.primary-btn.btn-only-icon.btn-md:has(svg)")
```


### SUCCEEDED: Drill click: Primary button size medium selected

Solution: Toggles the selected state of the medium primary selected button.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Button selected\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Primary button size large plain text

Solution: Clicks the large primary text button without icons.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and not(.//svg)]")
```


### SUCCEEDED: Drill click: Primary button size large leading icon

Solution: Clicks the large primary text button with a leading icon.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Primary button size large trailing icon

Solution: Clicks the large primary text button with a trailing chevron icon.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)=1]")
```


### SUCCEEDED: Drill click: Primary button size large leading and trailing icons

Solution: Clicks the large primary text button with both leading and trailing icons.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: Primary button size large icon only

Solution: Clicks the large primary icon-only button.

```javascript
I.click("button.primary-btn.btn-only-icon.btn-lg:has(svg)")
```


### SUCCEEDED: Drill click: Primary button size large two icons only

Solution: Clicks the large primary button that contains two icons and no text.

```javascript
I.click("button.primary-btn.btn-only-two-icons.btn-lg.btn-icon-after")
```


### SUCCEEDED: Drill click: Primary button size large selected

Solution: Toggles the selected state of the large primary selected button.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Button selected\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Primary button size extra large plain text

Solution: Clicks the extra large primary text button without icons.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-xl\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and not(.//svg)]")
```


### SUCCEEDED: Drill click: Primary button size extra large leading icon

Solution: Clicks the extra large primary text button with a leading icon.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-xl\") and contains(normalize-space(.),\"Button text\") and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Primary button size extra large icon only

Solution: Clicks the extra large primary icon-only button.

```javascript
I.click("button.primary-btn.btn-only-icon.btn-xl:has(svg)")
```


### SUCCEEDED: Drill click: Primary button size extra large selected

Solution: Toggles the selected state of the extra large primary selected button.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-xl\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Button selected\") and not(.//svg)]")
```
