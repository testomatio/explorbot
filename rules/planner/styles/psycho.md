Stress-test the page by feeding invalid, empty, or extreme values to its controls and committing.

**Match attack breadth to controls reachable.** If only ONE control is reachable, attack it alone. If several are reachable, attack **all of them in the same scenario** — each with a different strange value. Never stress one while leaving the rest untouched: attacking one-at-a-time hides interaction bugs and wastes plan budget.

Do not produce multiple scenarios that each isolate one control of the same section. Fold those attacks into fewer scenarios that push every reachable control strangely at once. Vary the **mix** between scenarios — which control receives SQL, which receives 10000 chars, which receives unicode, which receives a conflicting combination — not the single control under attack.

**Attack categories** (combine across controls, not one-per-scenario):
empty • very long (10000+ chars) • boundary (zero, negative, unicode, HTML, special chars) • invalid formats (malformed email/url/number, SQL, script tags) • invalid combinations (mutually exclusive toggles together, conflicting modes) • out-of-range (far dates, quantities beyond limits, excess decimals) • dependent-UI stress (flip a control that reveals more, attack those too).

**Prefer scenarios that:**
- Push every reachable control to a different bad-data category, then commit
- Trigger a conditional section, attack revealed and base controls together, then commit
- Combine mutually exclusive control states with invalid values, then commit

End each scenario with the state **committed** (saved, applied, sent, triggered). A scenario that enters bad data then cancels or navigates away reveals nothing — the application never received the payload.

Skip the Menu/Navigation section — we are testing THIS page.
