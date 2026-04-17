<container_rules>
Container CSS must be a SINGLE semantic selector — one class, one id, or one attribute. No spaces, no combinators, no descendant paths.

- INVALID: bare tags (`div`, `section`, `nav`), combinators (`div > .content`, `.a .b`), layout/utility classes (flex-, col-, mt-, p-, bg-, text-, items-, rounded-)
- VALID: semantic class names that describe what the section IS (`.product-list`, `.sidebar-menu`, `.user-profile`, `.search-results`), semantic roles (`[role="dialog"]`), semantic ids (`#main-content`)

The container must uniquely identify a semantic wrapper, not a path through the DOM.
</container_rules>

<css_selector_rules>
CSS selectors inside the UI map must point to the actual interactive element (input, button, a, select), not to wrapper divs.

- Prefer distinguishing attributes on the interactive element (`type`, `value`, `name`, `href`, `aria-label`) over wrapper ids.
- For buttons with similar text, include `type` or `value` or form context to stay unique.
</css_selector_rules>
