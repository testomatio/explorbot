# Vendored dependencies (temporary)

## `openrouter-ai-sdk-provider-pr511.tgz`

A prebuilt `@openrouter/ai-sdk-provider` from
[OpenRouterTeam/ai-sdk-provider#511](https://github.com/OpenRouterTeam/ai-sdk-provider/pull/511)
("feat: support Vercel AI SDK v7"), built from branch `feat/support-ai-sdk-v7`
(head `9e2941c9`).

**Why:** the released provider (2.3.3) targets AI SDK 6. Explorbot runs on AI SDK 7,
where the released provider rejects image inputs — the vision model (`see` tool /
screenshot analysis) fails with a bare `400 "Provider returned error"`. PR #511 migrates
the provider to AI SDK 7 / `@ai-sdk/provider` V4 and fixes image handling, so vision works.

`package.json` pins `@openrouter/ai-sdk-provider` to this tarball with a `file:` dependency.

**Remove once PR #511 is merged and released:** restore the normal semver constraint
(`"@openrouter/ai-sdk-provider": "^<released-version>"`), delete this tarball, and run
`bun install`.
