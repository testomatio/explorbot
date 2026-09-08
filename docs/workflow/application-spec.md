# Application Specs

An application spec is a versioned Markdown bundle that gives Explorbot previously collected information about an application. It can be produced by Docbot, another documentation tool, or by hand.

Live HTML, ARIA, and screenshots remain the source of truth. Explorbot uses matching spec pages as supporting context and does not load the whole bundle into every prompt.

## Configure

Set the bundle directory in `explorbot.config.js`:

```javascript
export default {
  dirs: {
    spec: 'spec',
  },
};
```

Paths are resolved from the project directory. Use `--spec <path>` on a web command to override the configured bundle for one run. Both the bundle directory and its `index.md` path are accepted.

## Bundle structure

```text
spec/
|-- index.md
`-- pages/
    |-- home.md
    `-- users.md
```

`index.md` is required and serves as a human-readable entry point. Its contents are not injected into agents. Page files may be nested anywhere below `pages/` and must use the contract below.

## Page contract

Every page is a Markdown file with YAML front matter:

```markdown
---
format: explorbot-application-spec
version: 1
url: /users
---

# Users

## Purpose

Lists the application's users.

## User Can

- user can search users by name
  Proof: A search field is visible above the user list.

## User Might

- user might export the user list
  Signal: An unlabeled download control is present.

## Navigation

- Invite user: /users/invite
```

The front matter fields are mandatory:

- `format` must be `explorbot-application-spec`.
- `version` must be `1`.
- `url` is the URL pattern used to select the page for the current browser state. It supports the same patterns as [knowledge files](./knowledge.md#url-patterns).

The Markdown body is supplied to agents as written, so headings beyond those shown above are allowed. Use `User Can` only for observed capabilities and transitions. Put inferred or unverified capabilities under `User Might`; Explorbot will require confirmation from the live UI before relying on them.

Screenshots and other relative links may be included for readers, but Explorbot currently consumes the Markdown text only.

## Validation

Explorbot rejects a bundle when `index.md` or `pages/` is missing, when it contains no page files, or when a page has an unsupported format, version, or missing URL.

## Scout

Beyond the per-URL injection, the same bundle feeds the [Scout agent](../reference/configuration.md#scout-agent): when Scout is enabled, it searches `pages/` (and any extra `ai.agents.scout.dirs`) for documentation relevant to the page being planned and reports it to the Planner. Pages already injected for the current URL are excluded from scouting, so the two channels never duplicate each other.
