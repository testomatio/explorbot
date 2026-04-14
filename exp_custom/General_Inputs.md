---
url: /projects/test-d6178/components/?m=false&s=General%20Inputs
title: Testomat.io
summary: Curated general input interactions only.
---
### SUCCEEDED: Drill fill: Basic input "Basic input"

Solution: Fills the basic text input.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Input"]]//input[@placeholder="Basic input"]')
I.fillField('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Input"]]//input[@placeholder="Basic input"]', 'Test Input')
```


### SUCCEEDED: Drill fill: Input with value "Input with value"

Solution: Replaces the existing input value with sample text.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Input"]]//input[@placeholder="Input with value"]')
I.fillField('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Input"]]//input[@placeholder="Input with value"]', 'Sample Text')
```


### SUCCEEDED: Drill fill: Text input "Text"

Solution: Fills the text input.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Text"]')
I.fillField('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Text"]', 'Sample Text')
```


### SUCCEEDED: Drill fill: Number input "Number"

Solution: Fills the number input.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Number"]')
I.fillField('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Number"]', '42')
```


### SUCCEEDED: Drill fill: Date input "Date"

Solution: Fills the date input.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Date"]')
I.fillField('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Date"]', '2026-04-12')
```


### SUCCEEDED: Drill fill: Time input "Time"

Solution: Fills the time input.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Time"]')
I.fillField('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Time"]', '12:30')
```


### SUCCEEDED: Drill fill: Password input "Password"

Solution: Fills the password input.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Password"]')
I.fillField('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Password"]', 'myPassword')
```


### SUCCEEDED: Drill fill: Email input "Email"

Solution: Fills the email input.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Email"]')
I.fillField('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Email"]', 'user@example.com')
```


### SUCCEEDED: Drill fill: Search input "Search"

Solution: Fills the search input.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Search"]')
I.fillField('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Search"]', 'example search')
```


### SUCCEEDED: Drill click: Checkbox input "Checkbox"

Solution: Toggles the checkbox input.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Checkbox"]')
```


### SUCCEEDED: Drill click: Radio input "Radio"

Solution: Selects the radio input.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="General Input with types"]]//input[@placeholder="Radio"]')
```
