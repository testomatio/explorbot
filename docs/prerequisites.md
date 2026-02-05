# Application Prerequisites

Explorbot works best with certain types of web applications. Use this checklist to verify your app is compatible.

## Target Applications

Explorbot is designed for:
- SaaS applications
- ERP systems
- Admin panels
- CRUD-heavy interfaces
- Internal business tools

## Quick Compatibility Checklist

### Application Type

- [ ] SaaS, ERP, admin panel, or CRUD-based system
- [ ] Single-user testing scenarios

### URL & State Management

- [ ] URLs reflect application state (`/users/123/edit`, `/projects/new`)
- [ ] Navigation changes the URL (not just JavaScript state)
- [ ] Page titles are meaningful and change with context
- [ ] Hash fragments used for sections (`/page#section`)

### Accessibility (ARIA)

- [ ] Buttons use `<button>` or have `role="button"`
- [ ] Form inputs have `<label>`, `aria-label`, or `placeholder`
- [ ] Interactive elements appear in the accessibility tree
- [ ] Modals and dialogs use `role="dialog"`
- [ ] Dropdowns/comboboxes have proper ARIA roles

### HTML Structure

- [ ] Semantic HTML elements (`<form>`, `<button>`, `<input>`, `<a>`)
- [ ] No Shadow DOM components (or minimal usage)
- [ ] Interactive elements are actual elements, not styled `<div>`s
- [ ] Forms have clear submit buttons

### Element Selectors

- [ ] Elements have stable attributes: `id`, `name`, `data-testid`
- [ ] No reliance on auto-generated IDs (`ember123`, `react-select-2-input`)
- [ ] Meaningful CSS classes (Tailwind is fine with semantic attributes)

## Supported Frameworks

Explorbot works with all major frontend frameworks:

- React / Next.js
- Vue / Nuxt
- Angular
- Ember
- Svelte / SvelteKit
- Plain HTML/JS

Custom components may need [Knowledge files](knowledge.md) to guide interaction.

## What Makes Testing Easier

**Good URL patterns:**
```
/users              → User list
/users/123          → User detail
/users/123/edit     → Edit user
/users/new          → Create user
```

**Good ARIA usage:**
```html
<button type="submit">Save</button>
<input aria-label="Search users" />
<div role="dialog" aria-labelledby="modal-title">
```

**Stable selectors:**
```html
<button data-testid="submit-btn">Submit</button>
<input name="email" id="user-email" />
```

## Common Issues

| Issue | Solution |
|-------|----------|
| Auto-generated IDs | Add `data-testid` or use ARIA labels |
| Divs acting as buttons | Use `<button>` or add `role="button"` |
| State in JS only | Ensure URL changes with navigation |
| Missing labels | Add `aria-label` to inputs |
| Shadow DOM | Extract key elements or avoid for critical paths |

## Next Steps

If your app meets most requirements:
1. Continue with [Quick Start](../README.md#quick-start)
2. Add [Knowledge files](knowledge.md) for custom components
3. Run `explorbot explore --from /your-page`

If your app has gaps, consider adding accessibility improvements — they benefit both Explorbot and real users.
