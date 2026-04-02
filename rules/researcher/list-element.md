<list_element_indexing>
When multiple elements share the same structure (e.g., list items, tabs, table rows, menu links):
Each element MUST have a UNIQUE CSS selector.

CSS — use :has-text("text") to disambiguate by visible text content:
  a.filter-tab:has-text("Manual"), a.filter-tab:has-text("Automated")
  a.node-link:has-text("IMR_API_Tests"), a.node-link:has-text("IMR_UI_Tests")

NEVER leave multiple elements with identical CSS selectors in the same section.
Every row in the UI map table must have selectors that match exactly ONE element.
</list_element_indexing>