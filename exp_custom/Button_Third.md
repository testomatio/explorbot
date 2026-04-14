---
url: /projects/test-d6178/components/?m=false&s=Button%3A%3AThird
title: Testomat.io
summary: Curated third button interactions only.
---
### SUCCEEDED: Drill click: Third button size mini icon only

Solution: Clicks the mini third icon-only button.

```javascript
I.click("button.third-btn.btn-only-icon.btn-mini")
```


### SUCCEEDED: Drill click: Third button size small plain text

Solution: Clicks the small third text button without icons.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and not(.//svg)]")
```


### SUCCEEDED: Drill click: Third button size small leading icon

Solution: Clicks the small third text button with a leading icon.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Third button size small trailing icon

Solution: Clicks the small third text button with a trailing chevron icon.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)=1]")
```


### SUCCEEDED: Drill click: Third button size small leading and trailing icons

Solution: Clicks the small third text button with both leading and trailing icons.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: Third button size small icon only

Solution: Clicks the small third icon-only button.

```javascript
I.click("button.third-btn.btn-only-icon.btn-sm")
```


### SUCCEEDED: Drill click: Third button size small selected

Solution: Toggles the selected state of the small third selected button.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-sm\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Button selected\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Third button size medium plain text

Solution: Clicks the medium third text button without icons.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and not(.//svg)]")
```


### SUCCEEDED: Drill click: Third button size medium leading icon

Solution: Clicks the medium third text button with a leading icon.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Third button size medium trailing icon

Solution: Clicks the medium third text button with a trailing chevron icon.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)=1]")
```


### SUCCEEDED: Drill click: Third button size medium leading and trailing icons

Solution: Clicks the medium third text button with both leading and trailing icons.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: Third button size medium icon only

Solution: Clicks the medium third icon-only button.

```javascript
I.click("button.third-btn.btn-only-icon.btn-md")
```


### SUCCEEDED: Drill click: Third button size medium selected

Solution: Toggles the selected state of the medium third selected button.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Button selected\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Third button size large plain text

Solution: Clicks the large third text button without icons.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and not(.//svg)]")
```


### SUCCEEDED: Drill click: Third button size large leading icon

Solution: Clicks the large third text button with a leading icon.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Third button size large trailing icon

Solution: Clicks the large third text button with a trailing chevron icon.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)=1]")
```


### SUCCEEDED: Drill click: Third button size large leading and trailing icons

Solution: Clicks the large third text button with both leading and trailing icons.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-icon-after\") and contains(normalize-space(.),\"Button text\") and count(.//svg)>=2]")
```


### SUCCEEDED: Drill click: Third button size large icon only

Solution: Clicks the large third icon-only button.

```javascript
I.click("button.third-btn.btn-only-icon.btn-lg")
```


### SUCCEEDED: Drill click: Third button size large two icons only

Solution: Clicks the large third button that contains two icons and no text.

```javascript
I.click("button.third-btn.btn-only-two-icons.btn-lg.btn-icon-after")
```


### SUCCEEDED: Drill click: Third button size large selected

Solution: Toggles the selected state of the large third selected button.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Button selected\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Third button size extra large plain text

Solution: Clicks the extra large third text button without icons.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-xl\") and contains(normalize-space(.),\"Button text\") and not(contains(@class,\"btn-icon-after\")) and not(.//svg)]")
```


### SUCCEEDED: Drill click: Third button size extra large leading icon

Solution: Clicks the extra large third text button with a leading icon.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-xl\") and contains(normalize-space(.),\"Button text\") and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Third button size extra large icon only

Solution: Clicks the extra large third icon-only button.

```javascript
I.click("button.third-btn.btn-only-icon.btn-xl")
```


### SUCCEEDED: Drill click: Third button size extra large selected

Solution: Toggles the selected state of the extra large third selected button.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-xl\") and contains(@class,\"btn-selected\") and contains(normalize-space(.),\"Button selected\") and not(.//svg)]")
```
