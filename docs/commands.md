# Terminal Commands Reference

All commands are available in the TUI when running `explorbot explore`.

## Exploration Commands

### `/explore [url]`

Start full exploration cycle: research → plan → test.

```
/explore
/explore /dashboard
```

If a URL is provided, navigates there first. After completion, use `/navigate` or `/explore` again to continue.

### `/research [url] [--data]`

Analyze the current page using the Researcher agent.

```
/research
/research /settings
/research --data
```

- If URL provided, navigates there first
- `--data` flag extracts structured data from the page

### `/plan [feature]`

Generate test scenarios for the current page using the Planner agent.

```
/plan
/plan login
/plan checkout flow
```

Optional feature focus narrows the scope of generated tests.

### `/test [scenario|number|*]`

Execute test scenarios using the Tester agent.

```
/test              # Run next pending test
/test *            # Run all pending tests
/test 2            # Run test #2 from plan
/test login        # Run tests matching "login"
/test User can logout successfully   # Create and run ad-hoc test
```

### `/navigate <target>`

Navigate to a URI or state using AI assistance.

```
/navigate /settings
/navigate login page
/navigate back to dashboard
```

The Navigator agent figures out how to reach the destination.

## Plan Management

### `/plan:save [filename]`

Save the current plan to a file.

```
/plan:save
/plan:save my-checkout-tests
```

Plans are saved to `output/plans/` directory.

### `/plan:load <filename>`

Load a previously saved plan.

```
/plan:load output/plans/checkout-plan.md
```

## Page Inspection

### `/aria [--short]`

Print the ARIA accessibility snapshot of the current page.

```
/aria
/aria --short
```

Useful for debugging element selectors and understanding page structure.

### `/html [--full]`

Print HTML snapshot of the current page.

```
/html
/html --full
```

- Default shows processed HTML
- `--full` shows complete text content

### `/data`

Extract structured data (tables, lists) from the current page.

```
/data
```

Uses AI to identify and format data on the page.

## Knowledge Management

### `/know [note]`

Store knowledge about the current page for future reference.

```
/know
/know Test user credentials: test@example.com / test123
```

Without arguments, opens an interactive editor. Knowledge is saved to `./knowledge/` and used by agents during exploration.

## Session Commands

### `/clean`

Clear the Captain agent's conversation history.

```
/clean
```

Useful when the agent context becomes too large or confused.

### `/exit`

Exit the application gracefully.

```
/exit
/quit
```

## Direct Browser Control

In addition to slash commands, you can execute CodeceptJS commands directly:

```
I.amOnPage('/login')
I.click('Submit')
I.fillField('email', 'test@example.com')
I.see('Welcome')
I.waitForElement('.modal', 5)
```

All [CodeceptJS Playwright helpers](https://codecept.io/helpers/Playwright/) are available.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `ESC` | Enable input / cancel current action |
| `Ctrl+T` | Toggle session timer display |
| `Ctrl+C` | Exit application |
