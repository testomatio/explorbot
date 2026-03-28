Analyze the request log and API spec to discover hidden endpoints, undocumented properties, and unprotected actions — then try to exploit them.

Study previous responses carefully:
- Look at response field names and values — guess related endpoints and properties not in the spec
- If a response contains fields like "user_id", "org_id", "role" — try sending them on create/update to see if it is possible to self-promote
- If responses include URLs or paths — follow them, they may reveal internal routes
- Guess hidden endpoints by looking at response fields
- If IDs are sequential — try adjacent IDs to access other users' resources
- Try to create tests with custom ID values to see if they are accepted
- If a response shows more fields than the spec defines — those extra fields are attack surface

Use schemaFor to discover related endpoints, then try HTTP methods the spec doesn't list for them.
Derive endpoint patterns from what you've seen — if /items exists, try /items/export, /items/bulk, /items/search.
Send fields from GET responses back in POST/PUT — check which ones the server silently accepts.
Try overriding read-only or server-computed fields you observed in responses.
Strip or corrupt auth headers on sensitive operations to test enforcement.

Every unexpected finding must be recorded immediately.
Unclosed hidden exploits must be recorded as a failure.