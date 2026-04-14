---
url: /projects/test-d6178/components/?m=false&s=PowerSelect%20Filters
title: Testomat.io
summary: Curated PowerSelect Filters interactions for simple selects, multiselects, date range, and filter actions.
---
### SUCCEEDED: Drill select option: PowerSelect Filters Type dropdown

Solution: Opens the Type PowerSelect filter and selects an option.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Type\"]]//*[self::div and @role=\"button\" and contains(.,\"Select Type\")]");
I.click({"role":"option","text":"Suite"});
```


### SUCCEEDED: Drill change option: PowerSelect Filters selected Type dropdown

Solution: Opens the selected Type PowerSelect filter and selects another option.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Type\"]]//*[self::div and @role=\"button\" and contains(.,\"Suite\")]");
I.click({"role":"option","text":"Test"});
```


### SUCCEEDED: Drill clear option: PowerSelect Filters selected Type dropdown

Solution: Clicks the selected Type PowerSelect filter value to clear it.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Type\"]]//*[self::div and @role=\"button\" and contains(.,\"Suite\")]//span[contains(@class,\"ember-power-select-clear-btn\")]")
```


### SUCCEEDED: Drill open date picker: PowerSelect Filters Date Range field

Solution: Opens the Date Range filter date picker.

```javascript
I.click("(//*[self::li and .//p[normalize-space(.)=\"Date Range\"]]//input[@placeholder=\"Select range\"])[1]")
```


### SUCCEEDED: Drill select date: PowerSelect Filters Date Range field

Solution: Opens the Date Range filter date picker and selects a date.

```javascript
I.click("(//*[self::li and .//p[normalize-space(.)=\"Date Range\"]]//input[@placeholder=\"Select range\"])[1]");
I.click("span[aria-label=\"April 15, 2026\"]");
```


### SUCCEEDED: Drill close date picker: PowerSelect Filters Date Range field

Solution: Opens the Date Range filter date picker and closes it.

```javascript
I.click("(//*[self::li and .//p[normalize-space(.)=\"Date Range\"]]//input[@placeholder=\"Select range\"])[1]");
I.pressKey("Escape");
```


### SUCCEEDED: Drill select option: PowerSelect Filters Changed by dropdown

Solution: Opens the Changed by PowerSelect filter and selects a user.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Changed by\"]]//*[self::div and @role=\"button\" and contains(.,\"Select user\")]");
I.click("//ul[@role=\"listbox\"]//li[@role=\"option\" and contains(.,\"Denys Kuchma (me)\")]");
```


### SUCCEEDED: Drill clear option: PowerSelect Filters selected Changed by dropdown

Solution: Clicks the selected Changed by PowerSelect filter value to clear it.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Changed by\"]]//*[self::div and @role=\"button\" and contains(.,\"(me)\")]//span[contains(@class,\"ember-power-select-clear-btn\")]")
```


### SUCCEEDED: Drill select option: PowerSelect Filters State dropdown

Solution: Opens the State PowerSelect filter and selects an option.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"State\"]]//*[self::div and @role=\"button\" and contains(.,\"Select State\")]");
I.click({"role":"option","text":"automated"});
```


### SUCCEEDED: Drill change option: PowerSelect Filters selected State dropdown

Solution: Opens the selected State PowerSelect filter and selects another option.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"State\"]]//*[self::div and @role=\"button\" and contains(.,\"manual\")]");
I.click({"role":"option","text":"automated"});
```


### SUCCEEDED: Drill clear option: PowerSelect Filters selected State dropdown

Solution: Clicks the selected State PowerSelect filter value to clear it.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"State\"]]//*[self::div and @role=\"button\" and contains(.,\"manual\")]//span[contains(@class,\"ember-power-select-clear-btn\")]")
```


### SUCCEEDED: Drill select option: PowerSelect Filters Tag multiselect

Solution: Opens the Tag PowerSelect multiselect filter and selects an option.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Tag\"]]//input[@placeholder=\"Select Tag\"]");
I.click({"role":"option","text":"@tag1"});
```


### SUCCEEDED: Drill toggle option: PowerSelect Filters selected Tag multiselect

Solution: Opens the selected Tag PowerSelect multiselect filter and toggles an option.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Tag\"]]//*[self::div and @role=\"button\" and contains(.,\"@tag1\") and contains(.,\"@tag2\") and contains(.,\"@tag3\")]");
I.click({"role":"option","text":"@tag2"});
```


### SUCCEEDED: Drill type option: PowerSelect Filters selected Tag multiselect

Solution: Focuses the selected Tag PowerSelect multiselect search input and confirms a typed option.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Tag\"] and .//*[contains(.,\"@tag1\")]]//input[contains(@class,\"ember-power-select-trigger-multiple-input\")]");
I.type("normal{Enter}");
```


### SUCCEEDED: Drill remove option: PowerSelect Filters selected Tag multiselect

Solution: Clicks a selected Tag PowerSelect multiselect remove control.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Tag\"] and .//*[contains(.,\"@tag1\")]]//span[@role=\"button\" and @aria-label=\"remove element\"]")
```


### SUCCEEDED: Drill select option: PowerSelect Filters Priority multiselect

Solution: Opens the Priority PowerSelect multiselect filter and selects an option.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Priority\"]]//input[@placeholder=\"Select Priority\"]");
I.click("//li[@role=\"option\" and contains(.,\"high\")]");
```


### SUCCEEDED: Drill open selected: PowerSelect Filters selected Priority multiselect

Solution: Opens the selected Priority PowerSelect multiselect filter.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Priority\"]]//*[self::div and @role=\"button\" and contains(.,\"low\") and contains(.,\"normal\") and contains(.,\"critical\")]")
```


### SUCCEEDED: Drill remove option: PowerSelect Filters selected Priority multiselect

Solution: Clicks a selected Priority PowerSelect multiselect remove control.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Priority\"] and .//*[contains(.,\"low\")]]//span[@role=\"button\" and @aria-label=\"remove element\"]")
```


### SUCCEEDED: Drill select option: PowerSelect Filters Assigned to dropdown

Solution: Opens the Assigned to PowerSelect filter and selects a user.

```javascript
I.click({"role":"button","text":"Select Assignee"});
I.click({"role":"option","text":"Denys Kuchma (me)"});
```


### SUCCEEDED: Drill clear option: PowerSelect Filters selected Assigned to dropdown

Solution: Clicks the selected Assigned to PowerSelect filter value to clear it.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Assigned to\"]]//*[self::div and @role=\"button\" and contains(.,\"(me)\")]//span[contains(@class,\"ember-power-select-clear-btn\")]")
```


### SUCCEEDED: Drill clear option: PowerSelect Filters selected Field dropdown

Solution: Clicks the selected Field PowerSelect filter value to clear it.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Field\"]]//*[self::div and @role=\"button\" and contains(.,\"Test\")]//span[contains(@class,\"ember-power-select-clear-btn\")]")
```


### SUCCEEDED: Drill change option: PowerSelect Filters selected Field dropdown

Solution: Opens the selected Field PowerSelect filter, searches, and selects another option.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Field\"]]//*[self::div and @role=\"button\" and contains(.,\"Test\")]");
I.fillField("//div[contains(@class,\"ember-basic-dropdown-content\") and not(contains(@style,\"display: none\"))]//input[@role=\"combobox\"]", "test");
I.pressKey("Enter");
```


### SUCCEEDED: Drill search option: PowerSelect Filters Value dropdown

Solution: Opens the Value PowerSelect filter, searches, and confirms the typed option.

```javascript
I.click("//*[self::li and .//p[normalize-space(.)=\"Value\"]]//*[self::div and @role=\"button\" and contains(.,\"Select value\")]");
I.fillField("//div[contains(@class,\"ember-basic-dropdown-content\") and not(contains(@style,\"display: none\"))]//input[@role=\"combobox\"]", "test");
I.pressKey("Enter");
```


### SUCCEEDED: Drill click: PowerSelect Filters Apply button

Solution: Clicks Apply to apply the selected filters.

```javascript
I.click("(//*[self::button and contains(@class,\"primary-btn\") and normalize-space(.)=\"Apply\"])[1]")
```


### SUCCEEDED: Drill click: PowerSelect Filters Cancel button

Solution: Clicks Cancel to discard the filter changes.

```javascript
I.click("(//*[self::button and contains(@class,\"secondary-btn\") and normalize-space(.)=\"Cancel\"])[1]")
```
