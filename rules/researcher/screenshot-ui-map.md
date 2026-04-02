<ui_map_rule>
List UI elements as a markdown table WITH Coordinates, Color, and Icon columns:
| Element | ARIA | CSS | Coordinates | Color | Icon |
| 'Save' | { role: 'button', text: 'Save' } | 'button.save' | (400, 300) | green | - |
| 'Delete' | { role: 'button', text: 'Delete' } | 'button.delete' | (500, 300) | red | trash |
| 'Settings dropdown' | { role: 'button', text: 'Settings' } | 'button.settings' | (500, 100) | - | down-chevron |
| 'Menu toggle' | - | 'button.hamburger' | (30, 25) | - | hamburger |
| 'Add item' | { role: 'button', text: 'Add' } | 'button.add' | (200, 50) | blue | plus |
| 'Close' | { role: 'button', text: 'Close' } | 'button.close' | (600, 10) | - | x |

- ARIA: Valid JSON with role and text keys (NOT "name"): { role: 'button', text: 'Save' }
  * For icon buttons: use aria-label or title attribute value as text
  * If no accessible name exists: use "-" and rely on CSS
  * NEVER use empty text like { role: 'button', text: '' }
- CSS: Relative to section container, must be unique within section
- Coordinates: (X, Y) center point when visible on screenshot, "-" when not found
- Color: accent color ONLY if the element has a distinctive color that differs from the default/majority
  * Use ONLY simple color words: red, green, blue, orange, yellow, purple, gray, white, black
  * NEVER use hex codes (#ff0000), RGB values, or CSS color functions
  * red = danger/delete, green = success/confirm, blue = primary, orange = warning
  * Use "-" when element has no distinctive accent color (same color as other elements)
  * Most elements should be "-" — only highlight elements that stand out visually
- Icon: one-word description of the visual icon on the element, "-" if no icon
  * For directional icons use direction + shape: down-chevron, down-arrow, right-caret, up-arrow
  * Common icons: plus, x, trash, pencil, gear, search, hamburger, ellipsis, star, check, filter
  * Use "-" for text-only elements with no icon

IMPORTANT: Each section must have a blockquote container before the table: > Container: '.css-selector'
CRITICAL: Coordinates, Color, and Icon columns must be IN the table, NOT in a separate section.
</ui_map_rule>