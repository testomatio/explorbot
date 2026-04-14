---
url: /projects/test-d6178/components/?m=false&s=Powerselect%3A%3AInput
title: Testomat.io
summary: Curated PowerSelect::Input interactions for search, single select, error states, and tag multiselect inputs.
---
### SUCCEEDED: Drill fill: PowerSelect::Input medium Search input

Solution: Fills the medium Search input.

```javascript
I.fillField("input[type=\"search\"][placeholder=\"Search\"].size-md", "text")
```


### SUCCEEDED: Drill clear: PowerSelect::Input medium Search input

Solution: Clears the typed medium Search input value.

```javascript
I.clearField("input[type=\"search\"][placeholder=\"Search\"].size-md")
```


### SUCCEEDED: Drill fill: PowerSelect::Input large Search input

Solution: Fills the large Search input.

```javascript
I.fillField("input[type=\"search\"][placeholder=\"Search\"].size-lg", "text")
```


### SUCCEEDED: Drill clear: PowerSelect::Input large Search input

Solution: Clears the typed large Search input value.

```javascript
I.clearField("input[type=\"search\"][placeholder=\"Search\"].size-lg")
```


### SUCCEEDED: Drill click: PowerSelect::Input User dropdown

Solution: Opens the User PowerSelect::Input dropdown.

```javascript
I.click("(//*[normalize-space(.)=\"User\"]/following::*[self::div and @role=\"button\" and contains(.,\"Select user\")])[1]")
```


### SUCCEEDED: Drill clear option: PowerSelect::Input selected User dropdown

Solution: Clicks the selected User PowerSelect::Input value to clear it.

```javascript
I.click("(//*[normalize-space(.)=\"User\"]/following::*[self::div and @role=\"button\" and contains(.,\"(Me)\")]//span[contains(@class,\"ember-power-select-clear-btn\")])[1]")
```


### SUCCEEDED: Drill click: PowerSelect::Input Name of select dropdown

Solution: Opens the Name of select PowerSelect::Input dropdown.

```javascript
I.click("(//*[normalize-space(.)=\"Name of select\"]/following::*[self::div and @role=\"button\" and contains(.,\"Select item\")])[1]")
```


### SUCCEEDED: Drill click: PowerSelect::Input selected Name of select dropdown

Solution: Opens the selected Name of select PowerSelect::Input dropdown.

```javascript
I.click("(//*[normalize-space(.)=\"Name of select\"]/following::*[self::div and @role=\"button\" and contains(.,\"Item 2\")])[1]")
```


### SUCCEEDED: Drill clear option: PowerSelect::Input selected Name of select dropdown

Solution: Clicks the selected Name of select PowerSelect::Input value to clear it.

```javascript
I.click("(//*[normalize-space(.)=\"Name of select\"]/following::*[self::div and @role=\"button\" and contains(.,\"Item 2\")]//span[contains(@class,\"ember-power-select-clear-btn\")])[1]")
```


### SUCCEEDED: Drill clear option: PowerSelect::Input error Name of select dropdown

Solution: Clicks the selected error-state Name of select PowerSelect::Input value to clear it.

```javascript
I.click("(//*[normalize-space(.)=\"Name of select (Error State)\"]/following::*[self::div and @role=\"button\" and contains(.,\"Item 2\")]//span[contains(@class,\"ember-power-select-clear-btn\")])[1]")
```


### SUCCEEDED: Drill click: PowerSelect::Input Tags multiselect

Solution: Opens the Tags PowerSelect::Input multiselect.

```javascript
I.click("(//*[normalize-space(.)=\"Tags\"]/following::*[self::div and @role=\"button\" and contains(.,\"Select a requirement source\")])[1]")
```


### SUCCEEDED: Drill type option: PowerSelect::Input Tags multiselect searchbox

Solution: Focuses the Tags PowerSelect::Input multiselect searchbox and types a tag.

```javascript
I.click("(//*[normalize-space(.)=\"Tags\"]/following::input[@type=\"search\" and @placeholder=\"Select a requirement source\"])[1]");
I.type("@tag1{Enter}");
```


### SUCCEEDED: Drill remove option: PowerSelect::Input selected Tags multiselect

Solution: Clicks a selected Tags PowerSelect::Input multiselect remove control.

```javascript
I.click("(//*[normalize-space(.)=\"Tags\"]/following::*[self::div and @role=\"button\" and contains(.,\"@tag1\") and contains(.,\"@tag2\")]//span[@role=\"button\" and @aria-label=\"remove element\"])[1]")
```


### SUCCEEDED: Drill click: PowerSelect::Input large User dropdown

Solution: Opens the large User PowerSelect::Input dropdown.

```javascript
I.click("(//*[normalize-space(.)=\"User\"]/following::*[self::div and @role=\"button\" and contains(.,\"Select user\")])[2]")
```


### SUCCEEDED: Drill clear option: PowerSelect::Input large selected User dropdown

Solution: Clicks the selected large User PowerSelect::Input value to clear it.

```javascript
I.click("(//*[normalize-space(.)=\"User\"]/following::*[self::div and @role=\"button\" and contains(.,\"(Me)\")]//span[contains(@class,\"ember-power-select-clear-btn\")])[2]")
```


### SUCCEEDED: Drill click: PowerSelect::Input large Name of select dropdown

Solution: Opens the large Name of select PowerSelect::Input dropdown.

```javascript
I.click("(//*[normalize-space(.)=\"Name of select\"]/following::*[self::div and @role=\"button\" and contains(.,\"Select item\")])[3]")
```


### SUCCEEDED: Drill clear option: PowerSelect::Input large selected Name of select dropdown

Solution: Clicks the selected large Name of select PowerSelect::Input value to clear it.

```javascript
I.click("(//*[normalize-space(.)=\"Name of select\"]/following::*[self::div and @role=\"button\" and contains(.,\"Item 2\")]//span[contains(@class,\"ember-power-select-clear-btn\")])[3]")
```


### SUCCEEDED: Drill click: PowerSelect::Input large Tags multiselect

Solution: Opens the large Tags PowerSelect::Input multiselect.

```javascript
I.click("(//*[normalize-space(.)=\"Tags\"]/following::*[self::div and @role=\"button\" and contains(.,\"Select a requirement source\")])[2]")
```


### SUCCEEDED: Drill remove option: PowerSelect::Input large selected Tags multiselect

Solution: Clicks a selected large Tags PowerSelect::Input multiselect remove control.

```javascript
I.click("(//*[normalize-space(.)=\"Tags\"]/following::*[self::div and @role=\"button\" and contains(.,\"@tag1\") and contains(.,\"@tag2\")]//span[@role=\"button\" and @aria-label=\"remove element\"])[2]")
```
