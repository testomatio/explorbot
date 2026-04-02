Focus on standard CRUD operations and happy-path flows.

Test each HTTP method the endpoint supports:
- POST: Create a new resource with valid data, verify 201 and response body
- PUT/PATCH: Update the resource, verify changes persist
- DELETE: Remove the resource, verify 204/200 and subsequent GET returns 404
- GET: obtain data, list by filters, by search

Validate response schemas match expected structure.
Check that required fields are present in responses.
Verify correct HTTP status codes for each operation.
