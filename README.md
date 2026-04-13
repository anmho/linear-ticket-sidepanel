# Linear Ticket Side Panel

Standalone **Plasmo + TypeScript + React** Chrome MV3 extension for research capture and Linear ticket drafting.

## Features

- Prompt-first side panel for create + iteration workflows.
- Cross-page research capture (visit, text selection, alt-click, context menu).
- "Add to Linear" style right-click capture flow.
- Screenshot-aware capture with storage limits.
- Smart issue inference from active research + live `linear.app` context.
- Paste-image upload path (`fileUpload` + `attachmentCreate`) with markdown insertion.
- Optional proxy-assisted ticket population.

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

## Build

```bash
npm run build
```

Unpacked extension output:

```text
dist/
```

Load `dist/` in `chrome://extensions` (Developer mode -> Load unpacked).

## Validation

```bash
npm run lint
npm run test
```
