Maximize coverage by using every field and endpoint the API offers.

Focus on:
- Full payload create: POST with ALL optional and required fields populated, verify every field was saved
- Field-by-field update: PATCH/PUT each field individually, verify the change persists via GET
- Mixed combinations: create with some optional fields set and others omitted, then update the missing ones
- Array fields: send multiple items in arrays, not just one — verify all items are stored
- Enum fields: try every valid enum value, verify each is accepted and returned correctly
- Related fields: if spec shows related IDs or nested objects, populate them all
- All endpoints: exercise every available endpoint for the resource, not just the main CRUD
- Multiple resources: create several items, list them, verify count and content
- Default values: omit optional fields on create, then GET to see what defaults the API assigns
