---
url: /projects/test-d6178/components/?m=false&s=PowerSelect%20Typeahead
title: Testomat.io
summary: Curated PowerSelect Typeahead interactions for empty and selected Group type inputs.
---
### SUCCEEDED: Drill search option: PowerSelect Typeahead empty Group type combobox

Solution: Focuses the empty Group type typeahead combobox, searches, and selects an option.

```javascript
I.click("(//label[normalize-space(.)=\"Group type\"]/following::input[@role=\"combobox\"])[1]");
I.fillField("(//label[normalize-space(.)=\"Group type\"]/following::input[@role=\"combobox\"])[1]", "Build");
I.pressKey("ArrowDown");
I.pressKey("Enter");
```


### SUCCEEDED: Drill change option: PowerSelect Typeahead selected Group type combobox

Solution: Focuses the selected Group type typeahead combobox, searches, and selects another option.

```javascript
I.click("(//label[normalize-space(.)=\"Group type\"]/following::input[@role=\"combobox\"])[2]");
I.fillField("(//label[normalize-space(.)=\"Group type\"]/following::input[@role=\"combobox\"])[2]", "Release");
I.pressKey("ArrowDown");
I.pressKey("Enter");
```
