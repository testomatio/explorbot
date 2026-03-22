import dedent from 'dedent';

const BUILT_IN_STYLES: Record<string, string> = {
  normal: dedent`
    Focus on standard CRUD operations and happy-path flows.

    Test each HTTP method the endpoint supports:
    - POST: Create a new resource with valid data, verify 201 and response body
    - GET: Read back the created resource, verify fields match
    - PUT/PATCH: Update the resource, verify changes persist
    - DELETE: Remove the resource, verify 204/200 and subsequent GET returns 404

    Validate response schemas match expected structure.
    Check that required fields are present in responses.
    Verify correct HTTP status codes for each operation.`,

  psycho: dedent`
    Stress-test the endpoint with invalid, malformed, and extreme inputs.

    Focus on:
    - Missing required fields: send partial payloads, empty objects, empty body
    - Wrong types: strings where numbers expected, numbers where strings expected
    - Malformed JSON: trailing commas, unquoted keys, broken UTF-8
    - SQL injection: "'; DROP TABLE users; --" in string fields
    - XSS payloads: "<script>alert(1)</script>" in text fields
    - Exposed secrets: passwords, tokens, etc
    - Oversized payloads: 10MB body, extremely long strings (10000+ chars)
    - Wrong Content-Type: send form data as JSON, JSON as XML
    - Invalid HTTP methods: PATCH on POST-only endpoints
    - Boundary values: negative numbers, zero, MAX_INT, empty arrays, null values

    Expect proper responses with meaningful error messages if related.
    If server strips broken data it is ok but check it doesn't store it.
    Responses must be carefully valudated to contain correct and secure data
    `,

  curious: dedent`
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
    - Related fields: if spec shows related IDs or nested objects, populate them all`,

  performer: dedent`
    Combine multiple API calls into composite workflows. Use RELATED endpoints together.

    Focus on:
    - Chain dependent calls: create parent → create child under parent → list children → verify linkage
    - Cross-endpoint workflows: if testing nested endpoints like /parent, also call /parent/{id}/children to check create sub-items
    - Full CRUD cycle in one scenario: POST → GET → PUT → GET (verify update) → DELETE → GET (verify 404)
    - Data integrity chains: create 3+ items → list all → filter → verify counts match
    - Cascade testing: create parent + children → delete parent → verify children are gone
    - Bulk + verify: create multiple items in sequence → GET list → verify all present with correct data
    - If API allows running multiple operations within one bulk request do it
    - State transitions: create → modify state → verify constraints change based on state

    Steps should reference related/sub-endpoints when the spec shows them.
    Discover related endpoints using schemaFor tool
    `,
};

export function getStyles(): Record<string, string> {
  return { ...BUILT_IN_STYLES };
}

export function getActiveStyle(iteration: number, override?: string): { name: string; approach: string } {
  const styles = getStyles();
  const names = Object.keys(styles);

  if (override) {
    const approach = styles[override];
    if (!approach) throw new Error(`Unknown planning style: "${override}". Available: ${names.join(', ')}`);
    return { name: override, approach };
  }

  const idx = iteration % names.length;
  const name = names[idx];
  return { name, approach: styles[name] };
}
