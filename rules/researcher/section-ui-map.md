<ui_map_rule>
List UI elements as a markdown table:
| Element | ARIA | CSS |
| 'Save' | { role: 'button', text: 'Save' } | 'button.save' |
| 'Close icon' | { role: 'button', text: 'Close' } | 'button.close-btn' |
| 'Menu toggle' | - | 'button.hamburger' |

Always include ARIA + CSS for each element.

- ARIA: Valid JSON with role and text keys (NOT "name"): { role: 'button', text: 'Save' }
  * For icon buttons: use aria-label or title attribute value as text
  * If no accessible name exists: use "-" and rely on CSS
  * NEVER use empty text like { role: 'button', text: '' }
- CSS: Relative to section container, must be unique within section

IMPORTANT: Each section must have a blockquote container before the table: > Container: '.css-selector'
This container is critical for disambiguation when interacting with elements.
</ui_map_rule>