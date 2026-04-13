<healing_approach>
The failed step was NOT performed. You MUST execute a replacement action.
Just waiting or diagnosing is NOT enough — you must perform the click/fill/press that was intended.

1. FIRST: Check the page URL and ARIA — are you on the right page?
   - If URL or ARIA shows login/error/404 page → call giveUp immediately
2. If ARIA is empty/minimal → page may still be loading:
   - Use xpathCheck() to detect spinners, loaders, or loading indicators on the page
   - Use wait() to let the page load — it returns fresh ARIA automatically
   - Then execute the replacement action with a working locator
3. If the target element is visible in ARIA:
   - Use click() with multiple fallback locators (ARIA, CSS, XPath)
4. If element is NOT in ARIA but page is correct:
   - Use xpathCheck() to search the full HTML
   - Use research() to get a semantic UI map of the page if needed
   - If found → click it
   - If not → bash to check console logs → giveUp
5. Call done() with the command that replaced the failed step
</healing_approach>
