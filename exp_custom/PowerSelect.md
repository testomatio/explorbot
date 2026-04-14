---
url: /projects/test-d6178/components/?m=false&s=PowerSelect
title: Testomat.io
summary: Curated PowerSelect interactions grouped by distinct custom component behaviors.
---
### SUCCEEDED: Drill select option: <AddRequirementForm> requirement source dropdown

Solution: Opens the requirement source PowerSelect dropdown and selects an option.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"Select a requirement source\")]");
I.click({"role":"option","text":"Confluence"});
```


### SUCCEEDED: Drill clear option: <AddRequirementForm> requirement source dropdown

Solution: Clicks the selected PowerSelect value to clear it.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"Confluence\")]")
```


### SUCCEEDED: Drill click: <AssignTo/> assignee dropdown

Solution: Opens the Assign to PowerSelect dropdown.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"Assign to\")]")
```


### SUCCEEDED: Drill click: <EditChart/> TQL data source dropdown

Solution: Opens the TQL search context PowerSelect dropdown.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"TQL search context\")]")
```


### SUCCEEDED: Drill select option: <EditChart/> tests data source dropdown

Solution: Opens the Data Source PowerSelect dropdown and selects an option.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"Tests\")]");
I.click({"role":"option","text":"Runs"});
```


### SUCCEEDED: Drill clear option: <ExportFilteredBox /> export mode dropdown

Solution: Clicks the selected PowerSelect value to clear it.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"Only found Tests\")]")
```


### SUCCEEDED: Drill select option: <FormTest /> format dropdown

Solution: Opens the format PowerSelect dropdown and selects an option.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"beautify\")]");
I.click({"role":"option","text":"json"});
```


### SUCCEEDED: Drill click: <InviteUser/> invite users dialog

Solution: Clicks the Invite users button and opens the invite user dialog.

```javascript
I.click("//*[self::button and contains(@class,\"primary-btn\") and contains(@class,\"btn-text-and-icon\") and contains(@class,\"btn-lg\") and normalize-space(.)=\"Invite users\" and not(.//svg)]")
```


### SUCCEEDED: Drill click: <Priority/> priority dropdown

Solution: Clicks the icon-only priority PowerSelect dropdown and opens its options.

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage-title \") and normalize-space(.)=\"<Priority/>\"]]//div[@role=\"button\" and contains(@class,\"ember-power-select-trigger\")]")
```


### SUCCEEDED: Drill select option: <SelectOs /> OS dropdown

Solution: Opens the OS PowerSelect dropdown and selects an option.

```javascript
I.click({"role":"button","text":"Select an OS"});
I.click({"role":"option","text":"Windows"});
```


### SUCCEEDED: Drill click: <Test /> action dropdown

Solution: Clicks the icon-only PowerSelect dropdown in the Test section and opens its options.

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage-title \") and normalize-space(.)=\"<Test />\"]]//div[@role=\"button\" and contains(@class,\"ember-power-select-trigger\")]")
```


### SUCCEEDED: Drill click: <ValidateNotificationRule /> run dropdown

Solution: Opens the run selection PowerSelect dropdown.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"Select a run to check\")]")
```


### SUCCEEDED: Drill select option: <Branches /> started by dropdown

Solution: Opens the Started by PowerSelect dropdown and selects a user.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"Started by\")]");
I.click({"role":"option","text":"Denys Kuchma"});
```


### SUCCEEDED: Drill clear option: <Branches /> selected user dropdown

Solution: Clicks the selected PowerSelect value to clear it.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"(Me)\")]")
```


### SUCCEEDED: Drill select option: <Imports::New /> automation framework dropdown

Solution: Opens the automation framework PowerSelect dropdown and selects an option.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"Select an automation framework you use\")]");
I.click({"role":"option","text":"Cucumber"});
```


### SUCCEEDED: Drill select option: <Imports::New /> language dropdown

Solution: Opens the language PowerSelect dropdown and selects an option.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"Select a language you use\")]");
I.click({"role":"option","text":"JavaScript"});
```


### SUCCEEDED: Drill verify disabled: <Setup /> disabled dropdowns

Solution: Verifies that the Setup section contains disabled PowerSelect dropdowns.

```javascript
I.seeElement("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage-title \") and normalize-space(.)=\"<Setup />\"]]//div[@role=\"button\" and @aria-disabled=\"true\" and contains(.,\"vitest\")]");
I.seeElement("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage-title \") and normalize-space(.)=\"<Setup />\"]]//div[@role=\"button\" and @aria-disabled=\"true\" and contains(.,\"JavaScript\")]");
```


### SUCCEEDED: Drill click: <Project /> timezone dropdown

Solution: Opens the project timezone PowerSelect dropdown.

```javascript
I.click("//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage \") and .//*[contains(concat(\" \", normalize-space(@class), \" \"), \" FreestyleUsage-title \") and normalize-space(.)=\"<Project />\"]]//div[@role=\"button\" and contains(@class,\"ember-power-select-trigger\") and not(normalize-space(.))][1]")
```


### SUCCEEDED: Drill select option: <Project /> framework dropdown

Solution: Opens the project framework PowerSelect dropdown and selects an option.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"vitest\")]");
I.click({"role":"option","text":"Cucumber"});
```


### SUCCEEDED: Drill click: <Project /> language dropdown

Solution: Opens the project language PowerSelect dropdown.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"JavaScript\")]")
```


### SUCCEEDED: Drill select option: <Show/> notification dropdown

Solution: Opens the notification PowerSelect dropdown and selects an option.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"How to notify\")]");
I.click({"role":"option","text":"Email"});
```


### SUCCEEDED: Drill select option: <EditTest /> manual type dropdown

Solution: Opens the manual test type PowerSelect dropdown and selects an option.

```javascript
I.click("//*[self::div and @role=\"button\" and contains(.,\"manual\")]");
I.click("//li[contains(@class,\"ember-power-select-option\") and contains(.,\"automated\")]");
```
