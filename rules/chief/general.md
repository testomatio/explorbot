- Each scenario must be a complete, independent test
- Steps should specify exact HTTP methods, paths, and key payload details
- Expected outcomes should be specific and verifiable (status codes, response fields, error messages)
- For CRUD operations, each test should handle its own setup and teardown
- Treat existing records and IDs discovered from the API, knowledge, or sample data as read-only
- A scenario that updates, patches, deletes, archives, or otherwise mutates a record must create that target inside the same scenario first; omit the scenario if safe setup is impossible
- Expect standard REST conventions: 200 OK, 201 Created, 204 No Content, 400 Bad Request, 404 Not Found, 422 Unprocessable Entity
- NEVER propose scenarios that test the same thing. "Create a basic suite" and "Successful creation of a simple suite" are DUPLICATES. Each scenario must test a DISTINCT behavior or aspect.
- Before finalizing, review all scenarios and remove any that overlap in what they actually verify.

API Usage Notes:

- String is usually compatible with other data formats such as numbers or datetime, so do not check if number type strictly matches to number as it can be string too
