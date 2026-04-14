---
url: /projects/test-d6178/components/?m=false&s=Tabs
title: Testomat.io
summary: Curated tab interactions from the Tabs component showcase.
---
### SUCCEEDED: Drill click: Inactive tab "Tab text" plain text

Solution: Clicks the inactive plain text tab.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Inactive tab"]]//li[@role="tab" and not(contains(@class,"ember-tabs__tab--selected")) and not(.//*[local-name()="svg"]) and not(.//button[contains(@class,"third-btn")]) and not(.//*[contains(@class,"new-counter")]) and not(.//*[contains(@class,"run-status")])]')
```


### SUCCEEDED: Drill click: Inactive tab "Tab text" leading icon

Solution: Clicks the inactive tab with a leading autorenew icon.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Inactive tab"]]//li[@role="tab" and not(contains(@class,"ember-tabs__tab--selected")) and .//*[local-name()="svg" and contains(@class,"md-icon-autorenew")] and not(.//button[contains(@class,"third-btn")]) and not(.//*[contains(@class,"new-counter")]) and not(.//*[contains(@class,"run-status")])]')
```


### SUCCEEDED: Drill click: Inactive tab "Tab text" trailing action icon

Solution: Clicks the inactive tab with a copy action icon.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Inactive tab"]]//li[@role="tab" and not(contains(@class,"ember-tabs__tab--selected")) and .//button[contains(@class,"third-btn")] and not(.//*[local-name()="svg" and contains(@class,"md-icon-autorenew")]) and not(.//*[contains(@class,"new-counter")]) and not(.//*[contains(@class,"run-status")])]')
```


### SUCCEEDED: Drill click: Inactive tab "Tab text" leading and trailing action icons

Solution: Clicks the inactive tab with a leading autorenew icon and copy action icon.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Inactive tab"]]//li[@role="tab" and not(contains(@class,"ember-tabs__tab--selected")) and .//*[local-name()="svg" and contains(@class,"md-icon-autorenew")] and .//button[contains(@class,"third-btn")] and not(.//*[contains(@class,"new-counter")]) and not(.//*[contains(@class,"run-status")])]')
```


### SUCCEEDED: Drill click: Inactive tab "Tab text 1" leading icon counter

Solution: Clicks the inactive tab with a counter.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Inactive tab"]]//li[@role="tab" and not(contains(@class,"ember-tabs__tab--selected")) and .//*[contains(@class,"new-counter")] and not(.//*[contains(@class,"run-status")])]')
```


### SUCCEEDED: Drill click: Inactive tab "Tab text" leading icon with run status icons

Solution: Clicks the inactive tab with run status indicators.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Inactive tab"]]//li[@role="tab" and not(contains(@class,"ember-tabs__tab--selected")) and .//*[contains(@class,"run-status")]]')
```


### SUCCEEDED: Drill click: Active tab "Tab text" plain text

Solution: Clicks the active plain text tab.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Active tab"]]//li[@role="tab" and contains(@class,"ember-tabs__tab--selected") and not(.//*[local-name()="svg"]) and not(.//button[contains(@class,"third-btn")]) and not(.//*[contains(@class,"new-counter")]) and not(.//*[contains(@class,"run-status")])]')
```


### SUCCEEDED: Drill click: Active tab "Tab text" leading icon

Solution: Clicks the active tab with a leading autorenew icon.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Active tab"]]//li[@role="tab" and contains(@class,"ember-tabs__tab--selected") and .//*[local-name()="svg" and contains(@class,"md-icon-autorenew")] and not(.//button[contains(@class,"third-btn")]) and not(.//*[contains(@class,"new-counter")]) and not(.//*[contains(@class,"run-status")])]')
```


### SUCCEEDED: Drill click: Active tab "Tab text" trailing action icon

Solution: Clicks the active tab with a copy action icon.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Active tab"]]//li[@role="tab" and contains(@class,"ember-tabs__tab--selected") and .//button[contains(@class,"third-btn")] and not(.//*[local-name()="svg" and contains(@class,"md-icon-autorenew")]) and not(.//*[contains(@class,"new-counter")]) and not(.//*[contains(@class,"run-status")])]')
```


### SUCCEEDED: Drill click: Active tab "Tab text" leading and trailing action icons

Solution: Clicks the active tab with a leading autorenew icon and copy action icon.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Active tab"]]//li[@role="tab" and contains(@class,"ember-tabs__tab--selected") and .//*[local-name()="svg" and contains(@class,"md-icon-autorenew")] and .//button[contains(@class,"third-btn")] and not(.//*[contains(@class,"new-counter")]) and not(.//*[contains(@class,"run-status")])]')
```


### SUCCEEDED: Drill click: Active tab "Tab text 1" leading icon counter

Solution: Clicks the active tab with a counter.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Active tab"]]//li[@role="tab" and contains(@class,"ember-tabs__tab--selected") and .//*[contains(@class,"new-counter")] and not(.//*[contains(@class,"run-status")])]')
```


### SUCCEEDED: Drill click: Active tab "Tab text" leading icon with run status icons

Solution: Clicks the active tab with run status indicators.

```javascript
I.click('//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)="Active tab"]]//li[@role="tab" and contains(@class,"ember-tabs__tab--selected") and .//*[contains(@class,"run-status")]]')
```
