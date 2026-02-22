# folo-mcp

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]

MCP server for [Folo](https://github.com/RSSNext/Folo)

## Usage

Set `FOLO_SESSION_TOKEN` environment variable to your Folo session token.

```bash
npx folo-mcp -y
```

## Behavior notes

- `entry_list` defaults to `publishedAfter = now - 7 days` when omitted.
- `entry_list` supports `withContent`, but content is truncated when too large.
- Responses are size-capped (default `FOLO_MAX_RESPONSE_CHARS=200000`).
- Entry content truncation limit is configurable (`FOLO_MAX_ENTRY_CONTENT_CHARS=8000`).
- Expired tokens return a clear message: update `FOLO_SESSION_TOKEN`.
- The server is read-only and does not expose mutation tools (for example, `mark_read`).

## Available read tools

- `entry_list`
- `entry_info`
- `subscription_list`
- `unread_count`
- `feed_info`

Configuration for [ChatWise](https://chatwise.app)

![CleanShot 2025-03-29 at 23 05 22@2x](https://github.com/user-attachments/assets/91b1841c-e556-4669-b68f-8afd51ce358c)

## Sponsors

<p align="center">
  <a href="https://github.com/hyoban/sponsors">
    <img src="https://raw.githubusercontent.com/hyoban/sponsors/main/sponsorkit/sponsors.svg" />
  </a>
</p>

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/folo-mcp?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/folo-mcp
[npm-downloads-src]: https://img.shields.io/npm/dm/folo-mcp?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/folo-mcp
