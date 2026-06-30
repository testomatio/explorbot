# Application prerequisites

Explorbot works best on CRUD-heavy web applications:

- SaaS platforms
- ecommerce
- ERP
- admin panels
- internal tools

It is not a good fit for landing pages, blogs, CMS, or static sites.

## Page management

Explorbot uses URLs as anchor points when it navigates. Each change in the URL, `title`, or `h1`-`h4` headings creates a new state. This is how Explorbot tracks where it is and analyzes each transition.

If your app does not change the URL on navigation, or skips `title` and `h1`-`h4`, navigation gets harder. Use URLs to identify your application states.

Set edge cases and domain rules in [Knowledge files](../guides/knowledge.md). These attach to page URLs.

## Web elements

Explorbot identifies elements through HTML, ARIA, and the screenshot. When one strategy fails, another usually works.

Avoid long scrolling pages. They make visual identification harder.

Explorbot reads ARIA attributes first, then falls back to HTML when ARIA elements are empty. An ARIA tree like this still works:

```
- role: button
  text:
```

Following A11y standards across your site improves results. Explorbot makes fewer failed attempts on common elements.

## Data management

Run Explorbot against an isolated workspace: a separate project inside your app, a staging environment, or similar. Pre-populate it with data. Explorbot reads that data to learn what the application does and proposes more meaningful tests.

Explorbot can change or delete data through the web interface. Make sure you can reload that data if something breaks.

To prepare:

- Add a dataset to the pages Explorbot will visit, so it learns the app faster.
- Keep that data non-critical and easy to restore.

## Security

Give Explorbot an isolated environment that can never touch production data. This is your responsibility.

Explorbot logs in with a user session and predefined credentials. Give that user limited permissions so it cannot harm the environment.

Do not put real sensitive data in that environment. Credit cards, tokens, and passwords cannot be protected, so use fake ones during sessions.

Explorbot runs with few privileges. Explorbot cannot:

- read or write local files (except the Captain agent, and only in the `knowledge/`, `experience/`, and `output/` folders)
- fetch content from external websites (it stays on the configured site)
- run Bash or CLI tools like `git` or `rm -rf` (except the Captain agent, for a limited set of actions)

Explorbot follows a predefined script and a plan. It does not act on its own. Its main actions are web and API requests, which you should restrict.

Run Explorbot on local, dev, or staging environments. You can still run it on production for regression testing, as long as its user has narrow access and works in a single project or workspace.
