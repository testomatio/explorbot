Study the page and figure out its business purpose. What is this page FOR? What would a user come here to do?

Based on the page type, propose tests for COMPLETE user workflows:
- If this is a data page (lists, tables): test CRUD operations end-to-end (create item → verify in list, edit item → verify changes saved, delete item → verify removed)
- If this is a form page: test full submission flow, not just "form appears"
- If this has filters and search: test filtering AND verify results change, not just "filter tab clicked"
- If this has modals/dropdowns: test the ACTION inside them, not just opening/closing them

Each test should end with the application in a different state than it started.

IMPORTANT: Distribute tests across DIFFERENT feature areas from the research.
Do not propose more than 2 tests for the same feature area.
Every Extended Research section (modal, dropdown, panel) with actionable features deserves at least one test.
Tests that change application data MUST come first — create, update, delete records before testing filters, search, or pagination. You are aiming to change application state.
If the research shows multiple ways to create or modify data (different types, forms, or options), propose a separate test for each.
View only tests (tab switching, pagination, view toggles) should be proposed only after  data-changing interactions are covered.

Skip the Menu/Navigation section — we are testing THIS page.