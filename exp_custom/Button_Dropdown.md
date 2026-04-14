---
url: /projects/test-d6178/components/?m=false&s=Button%3A%3ADropdown
title: Testomat.io
summary: Curated dropdown button interactions only.
---
### SUCCEEDED: Drill click: Dropdown button small icon trigger

Solution: Clicks the small dropdown button trigger and opens dropdown menu.

```javascript
I.click("div.primary-btn.btn-icon-after.btn-sm")
```


### SUCCEEDED: Drill click: Dropdown button small Default

Solution: Clicks the small Default dropdown button and opens dropdown menu.

```javascript
I.click("//*[self::div and contains(@class,\"primary-btn\") and contains(@class,\"btn-icon-after\") and contains(@class,\"btn-sm\") and normalize-space(.)=\"Default\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Dropdown button small Without icon

Solution: Clicks the small Without icon dropdown button and opens dropdown menu.

```javascript
I.click("//*[self::div and contains(@class,\"primary-btn\") and contains(@class,\"btn-icon-after\") and contains(@class,\"btn-sm\") and normalize-space(.)=\"Without icon\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Dropdown button medium icon trigger

Solution: Clicks the medium dropdown button trigger and opens dropdown menu.

```javascript
I.click("div.primary-btn.btn-icon-after.btn-md")
```


### SUCCEEDED: Drill click: Dropdown button medium Default

Solution: Clicks the medium Default dropdown button and opens dropdown menu.

```javascript
I.click("//*[self::div and contains(@class,\"primary-btn\") and contains(@class,\"btn-icon-after\") and contains(@class,\"btn-md\") and normalize-space(.)=\"Default\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Dropdown button medium Without icon

Solution: Clicks the medium Without icon dropdown button and opens dropdown menu.

```javascript
I.click("//*[self::div and contains(@class,\"primary-btn\") and contains(@class,\"btn-icon-after\") and contains(@class,\"btn-md\") and normalize-space(.)=\"Without icon\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Dropdown button large icon trigger

Solution: Clicks the large dropdown button trigger and opens dropdown menu.

```javascript
I.click("div.primary-btn.btn-icon-after.btn-lg")
```


### SUCCEEDED: Drill click: Dropdown button large Default

Solution: Clicks the large Default dropdown button and opens dropdown menu.

```javascript
I.click("//*[self::div and contains(@class,\"primary-btn\") and contains(@class,\"btn-icon-after\") and contains(@class,\"btn-lg\") and normalize-space(.)=\"Default\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: Dropdown button large Without icon

Solution: Clicks the large Without icon dropdown button and opens dropdown menu.

```javascript
I.click("//*[self::div and contains(@class,\"primary-btn\") and contains(@class,\"btn-icon-after\") and contains(@class,\"btn-lg\") and normalize-space(.)=\"Without icon\" and not(.//svg)]")
```
