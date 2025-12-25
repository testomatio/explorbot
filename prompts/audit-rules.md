# Prompt Audit System for Web Navigation/Testing Rules

You are an expert prompt engineer specializing in AI-driven web testing automation. Your task is to audit the prompts and rules used for web navigation and testing in this codebase.

## Files to Analyze

1. **`@src/ai/rules.ts`** - Core rules and guidelines for locators, actions, and verification
2. **`@src/ai/navigator.ts`** - Uses rules in prompts for navigation and verification
3. **`@src/ai/tools.ts`** - Tool definitions that include locator rules and guidance

## Audit Checklist

### 1. Rules Analysis (`rules.ts`)

Look for:
- **Contradictions**: Rules that conflict with each other (e.g., "prefer ARIA" vs "use text first")
- **Ambiguity**: Vague guidance that could be interpreted multiple ways
- **Incomplete guidance**: Missing priority order, missing edge cases
- **Locator priority**: Is ARIA → Text → CSS → XPath clearly defined?
- **Disambiguation**: How to choose between multiple matching elements?
- **Context parameter**: When and how to use it?
- **Short vs Long locators**: Clear definitions?
- **Unused rules**: Exported but never imported anywhere

### 2. Rule Usage Analysis (`navigator.ts`)

Check:
- **Imported but unused**: Rules imported but not used in prompts
- **Missing rules**: Prompts that should include locatorRule or actionRule but don't
- **Duplication**: Inline rules that duplicate what's in rules.ts
- **Consistency**: Do prompts follow the same structure?
- **HTML tags**: Is HTML content wrapped in `<page_html>` tags?

### 3. Tools Analysis (`tools.ts`)

Verify:
- **locatorRule usage**: Do tools that accept locators include locatorRule?
- **Input schema descriptions**: Do they mention "ARIA, CSS or XPath"?
- **Suggestions on failure**: Do failed results provide helpful suggestions?
- **Unreachable code paths**: Logic that can never execute (like type with undefined locator)
- **Consistent error handling**: Same pattern across all tools
- **Tool differentiation**: Clear when to use click vs clickByText, type with/without locator

## Severity Levels

| Severity | Description | Examples |
|----------|-------------|----------|
| **🔴 Critical** | Breaks functionality or causes wrong behavior | Contradictory rules, unreachable code, missing required rules |
| **🟠 High** | Significant confusion or incorrect guidance | Ambiguous priority, misleading examples, wrong format |
| **🟡 Medium** | Suboptimal but functional | Redundant rules, verbose descriptions, missing suggestions |
| **🟢 Minor** | Cosmetic or style issues | Typos, formatting, inconsistent spacing |

## Output Format

Structure your findings as follows:

```markdown
## Audit Results

### Critical Issues 🔴
1. **[File:Line]** Issue description
   - Impact: What goes wrong
   - Fix: Suggested resolution

### High Priority Issues 🟠
1. **[File:Line]** Issue description
   - Impact: What confusion this causes
   - Fix: Suggested resolution

### Medium Priority Issues 🟡
1. **[File:Line]** Issue description
   - Impact: Why this matters
   - Fix: Suggested resolution

### Minor Issues 🟢
1. **[File:Line]** Issue description
   - Fix: Suggested resolution

### Observations
- General patterns noticed
- Recommendations for improvement
- Questions for clarification
```

## Specific Things to Check

### Locator Rules
- [ ] Priority order clearly defined (ARIA → Text → CSS → XPath)
- [ ] Context parameter explained (when to use, which tools support it)
- [ ] Disambiguation strategy documented (form flow, ARIA state, proximity)
- [ ] Short vs Long locators defined
- [ ] Examples consistent with rules (single quotes vs double quotes in JSON)

### Action Rules
- [ ] Function signatures included (I.click, I.fillField, I.see, etc.)
- [ ] Required parameters explained (context for I.see)
- [ ] Prohibited actions listed (no wait functions, no amOnPage)
- [ ] Examples match documented format

### Verification Rules
- [ ] I.see requires context parameter
- [ ] I.seeElement prefers ARIA locators
- [ ] Strictness rules to avoid false positives
- [ ] Examples show correct usage

### Tool Definitions
- [ ] Each tool includes relevant rules (locatorRule where needed)
- [ ] Input schemas describe all locator types
- [ ] Failed results include actionable suggestions
- [ ] Description explains when to use this tool vs alternatives

## Run This Audit

To run this audit, execute:

```
Please analyze the following files for prompt/rule issues:
@src/ai/rules.ts
@src/ai/navigator.ts  
@src/ai/tools.ts

Follow the audit checklist and output format defined in @prompts/audit-rules.md
```

