Stress-test the endpoint with invalid, malformed, and extreme inputs.

Focus on:
- Missing required fields: send partial payloads, empty objects, empty body
- Wrong types: strings where numbers expected, numbers where strings expected
- Malformed JSON: trailing commas, unquoted keys, broken UTF-8
- SQL injection
- XSS payloads
- Exposed secrets: passwords, tokens, etc
- Oversized payloads: 10MB body, extremely long strings (10000+ chars)
- Wrong Content-Type: send form data as JSON, JSON as XML
- Invalid HTTP methods: PATCH on POST-only endpoints
- Boundary values: negative numbers, zero, MAX_INT, empty arrays, null values

Expect proper responses with meaningful error messages if related.
If server strips broken data it is ok but check it doesn't store it.
Responses must be carefully valudated to contain correct and secure data