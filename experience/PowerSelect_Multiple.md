---
url: /projects/test-d6178/components/?m=false&s=PowerSelect%20Multiple
title: Testomat.io
summary: Curated PowerSelect Multiple interactions for AssignMultiple.
---
### SUCCEEDED: Drill select all: <AssignMultiple> assign users multiselect

Solution: Clicks the Select All button for the assign users multiselect.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and normalize-space(.)=\"Select All\" and not(.//svg)]")
```


### SUCCEEDED: Drill select option: <AssignMultiple> assign users multiselect

Solution: Opens the assign users multiselect and selects a user.

```javascript
I.click({"role":"searchbox","text":"Assign Users"});
I.click({"role":"option","text":"Denys Kuchma"});
```


### SUCCEEDED: Drill remove selected users: <AssignMultiple> assign users multiselect

Solution: Clicks the Remove assign users button for the assign users multiselect.

```javascript
I.click("//*[self::button and contains(@class,\"third-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-md\") and normalize-space(.)=\"Remove assign users\" and not(.//svg)]")
```
