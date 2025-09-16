# Development notes

This repository hosts a single Tampermonkey userscript, [`NovelBin.me Chapter Aggregator Simplified.js`](../NovelBin.me%20Chapter%20Aggregator%20Simplified.js). The code is intentionally framework-free so that it can be maintained and debugged directly inside the Tampermonkey dashboard.

## Boot sequence
1. The metadata block declares supported NovelBin domains and Tampermonkey permissions (`GM_xmlhttpRequest`, `GM_download`, `GM_setValue`, `GM_getValue`).
2. A self-invoking function wraps the entire script to avoid leaking globals into the page context.
3. `init()` delays execution by 1.5 seconds to wait for the chapter list to render and then constructs a `UIController` instance.

## Core modules

### SettingsManager
- Stores default values for batch size, delay, retry cap, logging toggle, and compact UI mode.
- Persists overrides using Tampermonkey storage via `GM_getValue`/`GM_setValue` with JSON serialization.
- Exposes `get`, `set`, and `reset` helpers so UI code can transparently update values.

### Logger
- Lightweight ring buffer (up to 1000 entries) that prints to both Tampermonkey logs and the in-panel log window.
- Supports `info`, `warn`, `error`, and `debug` levels plus `exportLogs()` which triggers a file download containing formatted entries.
- Controlled via the settings toggle; when disabled it silently no-ops for minimal overhead.

### ChapterExtractor
- Refreshes its copy of settings whenever a download begins and exposes `cancel()`/`reset()` to coordinate with the UI state machine.
- Uses `GM_xmlhttpRequest` with exponential backoff to fetch chapter pages. Errors bubble up after the retry budget is exhausted so the UI can mark them as failed.
- Parses returned HTML with `DOMParser`, locating titles/content via selector fallbacks and removing ads or extraneous markup before returning sanitized chapter objects.
- `processChapters()` handles batching, progress callbacks, and cancellation semantics while collating successful and failed chapter results.

### DragHandler
- Provides click-and-drag movement for the floating control panel header while constraining movement to the viewport.

### UIController
- Orchestrates chapter discovery, renders the floating panel, binds button handlers, and manages state transitions between idle, downloading, and cancelled states.
- Maintains optional range selection, toggles the settings view, and surfaces notifications for success/error events.
- Handles log toggle/export buttons and writes progress updates to the progress bar plus status badges.

### HTML generator
- `generateAndDownloadHTML()` stitches all fetched chapters into a standalone HTML document that includes navigation, responsive layout rules, chapter metadata, and keyboard shortcuts.
- File names incorporate the sanitized novel title, chapter count, timestamp, and a short content hash for deduplication.

## Adding new features
- Prefer adding new UI controls inside `createUI()` and register events in `bindUIEvents()` to keep layout and behavior synchronized.
- When introducing persistent settings, update `SettingsManager.defaultSettings`, extend the settings modal markup, and wire the control into `saveSettings()`/`resetSettings()`.
- Always surface user feedback with `showNotification()` so that background operations visibly report success or failure.

## Testing checklist
- Verify chapter extraction on both novelbin.me and novelbin.com domains (the HTML differs slightly).
- Smoke-test extreme ranges (single chapter, entire list) and ensure cancellation clears active requests.
- Inspect exported HTML in desktop and mobile viewports; confirm sidebar toggling, keyboard shortcuts, and scroll progress behave correctly.

## Troubleshooting tips
- If chapters fail consistently, check the log export for HTML selector mismatches and update the selector arrays in `extractChapterContent()` accordingly.
- Missing content often stems from new NovelBin ad wrappers—extend the `unwantedSelectors` array or regex cleaners to strip them.
- NovelBin occasionally rate limits aggressive scraping. Recommend users reduce batch size or increase delay via settings before escalating issues.
