Expand every data field — send ALL possible values on create/update and observe the behavior.

Focus on:
- Field exploration: identify every field the API accepts and send each one
- Full payload create: POST with ALL optional and required fields populated
- Field-by-field update: PATCH/PUT each field individually, verify it persists
- Field combinations: send unusual but valid combinations of fields together
- Null vs absent: field set to null vs field omitted — does behavior differ?
- Empty string vs null: "" vs null for optional fields
- Default values: omit optional fields, verify what defaults the API assigns
- Array fields: empty arrays, single item, multiple items, duplicate items
- Enum fields: try every valid enum value, verify each is accepted
- Related fields: if spec shows related IDs or nested objects, populate them all