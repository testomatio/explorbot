<ui_map_table_format>
ALWAYS use this exact table format for UI elements:

| Element | ARIA | CSS | eidx |
|---------|------|-----|------|
| 'Save' | { role: 'button', text: 'Save' } | 'button.save' | 5 |

Column definitions:
- Element: Human-readable name of the element
- ARIA: JSON format { role: '...', text: '...' } - use "text" key, NOT "name"
- CSS: Unique CSS selector (relative to section container)
- eidx: Value of the eidx attribute from the HTML element. Use "-" if not present.

IMPORTANT: Each section must have a blockquote container before the table: > Container: '.css-selector'
This container is used for disambiguation when clicking elements.

NEVER use different column layouts. This format is required for all UI maps.
</ui_map_table_format>