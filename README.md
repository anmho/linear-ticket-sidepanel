# Linear Ticket Side Panel

`linear-ticket-sidepanel` is a Manifest V3 Chrome extension that uses the browser side panel as a persistent vibecoding workspace for page context, Linear ticket context, and a future MCP proxy.

## Features In This Slice

- Opens in Chrome's side panel instead of a popup.
- Uses branded extension icons in the toolbar and extensions list.
- Uses live `linear.app` session context for the active issue/draft without requiring an API key.
- Stores a Linear personal API key in `chrome.storage.local` only when you want assigned-issue listing and direct GraphQL issue creation.
- Stores an optional proxy URL and proxy token in `chrome.storage.local`.
- Reads the active tab title and URL for ticket context.
- Lists the current user's assigned Linear issues.
- Lets you select a Linear issue as active vibe context.
- Generates and copies a structured context payload for a future MCP proxy.
- Can send a text-only request to a proxy endpoint if one is available.
- Creates a new Linear issue using the active page as source context.
- Only enables the side panel on `linear.app`.
- Opens the side panel with low latency on common Linear issue-creation clicks and focus flows.

## Local Usage

1. Build the extension:

   ```bash
   npx nx run linear-ticket-sidepanel:build
   ```

2. Open Chrome and navigate to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select `dist/apps/linear-ticket-sidepanel`.
6. Click the extension action to open the side panel.
7. Open an issue or `New issue` flow on `linear.app` to populate live session context automatically.
8. Paste a Linear personal API key only if you want assigned issues and direct API-backed create/list flows.
9. Optionally set a proxy URL if you have a text endpoint to test.
10. Use `Copy context pack` to inspect what the extension will send to a future MCP proxy.
11. On `linear.app`, try clicking `New issue`, an issue card, or focusing an issue title/description field to trigger the side panel instantly.

## Notes

- The live session mode reads the current `linear.app` UI context instead of scraping cookies or requiring an API key.
- The API key and optional proxy settings are stored only in local extension storage on the current browser profile.
- This slice still uses a personal API key for deeper Linear API flows, not OAuth.
- The proxy integration is deliberately text-only for now and keeps a seam open for future MCP-backed tools like search and GSuite access.
- The panel is intentionally scoped to `linear.app` so it stays inactive on unrelated sites.
- The build script copies source files into `dist/apps/linear-ticket-sidepanel` without bundling.
