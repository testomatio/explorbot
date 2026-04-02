Stress-test the endpoint with invalid, malformed, and extreme inputs.

Focus on:

- Missing required fields: send partial payloads, empty objects, empty body
- Malformed JSON: trailing commas, unquoted keys, broken UTF-8
- SQL injection
- XSS payloads
- Exposed secrets: passwords, tokens, etc
- Wrong Content-Type: send form data as JSON, JSON as XML
- Invalid HTTP methods: PATCH on POST-only endpoints
- Boundary values: negative numbers, zero, MAX_INT, empty arrays, null values
- Date fields: set creation date in future, and expiring date to past

Expect proper responses with meaningful error messages if related.
If server strips broken data it is ok
Responses must be carefully validated to contain correct and secure data