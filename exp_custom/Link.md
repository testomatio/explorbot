---
url: /projects/test-d6178/components/?m=false&s=Link
title: Testomat.io
summary: Curated link interactions only.
---
### SUCCEEDED: Drill click: Primary link size medium leading icon

Solution: Clicks the medium primary link with a leading icon. Opens the link in a new tab (target="_blank").

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(@class,\"FreestyleUsage-title\") and normalize-space(.)=\"Link::Primary - md\"]]//a[contains(@class,\"baseLink\") and contains(@class,\"primary\") and contains(@class,\"link-md\") and contains(normalize-space(.),\"Link\") and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Primary link size medium plain text

Solution: Clicks the medium primary text link without icons. Opens the link in a new tab (target="_blank").

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(@class,\"FreestyleUsage-title\") and normalize-space(.)=\"Link::Primary - md\"]]//a[contains(@class,\"baseLink\") and contains(@class,\"primary\") and contains(@class,\"link-md\") and contains(normalize-space(.),\"Link\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Primary link size medium trailing icon

Solution: Clicks the medium primary link with a trailing icon. Opens the link in a new tab (target="_blank").

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(@class,\"FreestyleUsage-title\") and normalize-space(.)=\"Link::Primary - md\"]]//a[contains(@class,\"baseLink\") and contains(@class,\"primary\") and contains(@class,\"link-md\") and contains(normalize-space(.),\"Link\") and ./*[last()][self::svg]]")
```


### SUCCEEDED: Drill click: Primary link size small leading icon

Solution: Clicks the small primary link with a leading icon. Opens the link in a new tab (target="_blank").

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(@class,\"FreestyleUsage-title\") and normalize-space(.)=\"Link::Primary - sm\"]]//a[contains(@class,\"baseLink\") and contains(@class,\"primary\") and contains(@class,\"link-sm\") and contains(@class,\"text-xs\") and contains(normalize-space(.),\"Link\") and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Primary link size small plain text

Solution: Clicks the small primary text link without icons. Opens the link in a new tab (target="_blank").

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(@class,\"FreestyleUsage-title\") and normalize-space(.)=\"Link::Primary - sm\"]]//a[contains(@class,\"baseLink\") and contains(@class,\"primary\") and contains(@class,\"link-sm\") and contains(@class,\"text-xs\") and contains(normalize-space(.),\"Link\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Primary link size small trailing icon

Solution: Clicks the small primary link with a trailing icon. Opens the link in a new tab (target="_blank").

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(@class,\"FreestyleUsage-title\") and normalize-space(.)=\"Link::Primary - sm\"]]//a[contains(@class,\"baseLink\") and contains(@class,\"primary\") and contains(@class,\"link-sm\") and contains(@class,\"text-xs\") and contains(normalize-space(.),\"Link\") and ./*[last()][self::svg]]")
```


### SUCCEEDED: Drill click: Secondary link size medium leading icon

Solution: Clicks the medium secondary link with a leading icon. Opens the link in a new tab (target="_blank").

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(@class,\"FreestyleUsage-title\") and normalize-space(.)=\"Link::Secondary - md\"]]//a[contains(@class,\"baseLink\") and contains(@class,\"secondary\") and contains(@class,\"link-md\") and contains(normalize-space(.),\"Link\") and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Secondary link size medium plain text

Solution: Clicks the medium secondary text link without icons. Opens the link in a new tab (target="_blank").

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(@class,\"FreestyleUsage-title\") and normalize-space(.)=\"Link::Secondary - md\"]]//a[contains(@class,\"baseLink\") and contains(@class,\"secondary\") and contains(@class,\"link-md\") and contains(normalize-space(.),\"Link\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Secondary link size medium trailing icon

Solution: Clicks the medium secondary link with a trailing icon. Opens the link in a new tab (target="_blank").

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(@class,\"FreestyleUsage-title\") and normalize-space(.)=\"Link::Secondary - md\"]]//a[contains(@class,\"baseLink\") and contains(@class,\"secondary\") and contains(@class,\"link-md\") and contains(normalize-space(.),\"Link\") and ./*[last()][self::svg]]")
```


### SUCCEEDED: Drill click: Secondary link size small leading icon

Solution: Clicks the small secondary link with a leading icon. Opens the link in a new tab (target="_blank").

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(@class,\"FreestyleUsage-title\") and normalize-space(.)=\"Link::Secondary - sm\"]]//a[contains(@class,\"baseLink\") and contains(@class,\"secondary\") and contains(@class,\"link-sm\") and contains(@class,\"text-xs\") and contains(normalize-space(.),\"Link\") and ./*[1][self::svg]]")
```


### SUCCEEDED: Drill click: Secondary link size small plain text

Solution: Clicks the small secondary text link without icons. Opens the link in a new tab (target="_blank").

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(@class,\"FreestyleUsage-title\") and normalize-space(.)=\"Link::Secondary - sm\"]]//a[contains(@class,\"baseLink\") and contains(@class,\"secondary\") and contains(@class,\"link-sm\") and contains(@class,\"text-xs\") and contains(normalize-space(.),\"Link\") and not(.//svg)]")
```


### SUCCEEDED: Drill click: Secondary link size small trailing icon

Solution: Clicks the small secondary link with a trailing icon. Opens the link in a new tab (target="_blank").

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(@class,\"FreestyleUsage-title\") and normalize-space(.)=\"Link::Secondary - sm\"]]//a[contains(@class,\"baseLink\") and contains(@class,\"secondary\") and contains(@class,\"link-sm\") and contains(@class,\"text-xs\") and contains(normalize-space(.),\"Link\") and ./*[last()][self::svg]]")
```


