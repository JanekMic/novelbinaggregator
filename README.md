# NovelBin Chapter Aggregator Simplified

A Tampermonkey user script that gathers every chapter listed on a NovelBin series page and exports them into a polished, self-contained HTML reader. The script ships with a floating control panel, automatic retry logic for chapter fetches, persistent settings, and a modern reading layout so that multi-chapter binge sessions stay organized.

## Features
- **One-click aggregation** – scan the visible chapter list on novelbin.me/com and queue each chapter for download with batching controls. 
- **Robust downloading** – resilient fetch pipeline with exponential backoff, per-request cancellation, and retry limits to avoid hammering the host while still completing long runs.
- **Range and bulk selection** – choose the full catalog or provide start/stop chapter numbers before downloading.
- **Persistent configuration** – tweak batch size, delay, retry cap, logging, and compact UI mode; settings survive browser restarts via Tampermonkey storage.
- **Detailed logging** – optional INFO/WARN/ERROR/DEBUG trace window with export-to-file support for troubleshooting scraped content.
- **Modern HTML output** – generates a responsive reading experience with sidebar navigation, scroll progress, keyboard shortcuts, and metadata summary that work fully offline.

## Requirements
- A Chromium- or Firefox-based browser that supports Tampermonkey
- Tampermonkey extension (stable release recommended)
- Access to https://novelbin.me or https://novelbin.com chapter listing pages

## Installation
1. Install the [Tampermonkey extension](https://www.tampermonkey.net/) in your browser of choice.
2. Click the Tampermonkey toolbar icon and choose **Create a new script…**.
3. Replace the placeholder code with the contents of [`NovelBin.me Chapter Aggregator Simplified.js`](./NovelBin.me%20Chapter%20Aggregator%20Simplified.js).
4. Save the script (Tampermonkey defaults to `Ctrl+S`/`Cmd+S`) and ensure it is enabled.
5. Navigate to any NovelBin series page that lists chapters (`/novel/<slug>/`). The floating aggregator button should appear once the page loads.

> **Tip:** If you prefer the raw file URL, use `https://raw.githubusercontent.com/<your-fork>/novelbinaggregator/work/NovelBin.me%20Chapter%20Aggregator%20Simplified.js` once your fork is online.

## Usage overview
1. Open a NovelBin chapter list page. Wait for the purple circular **📚** toggle button to appear.
2. Click the toggle button to open the control panel.
3. (Optional) Enter a start and end chapter number, then press **🎯 Select Range**. Skip this to download every chapter currently detected.
4. Press **📥 Download All Chapters**. Progress information, retry attempts, and status will stream into the panel while batches run.
5. When complete, a single HTML file downloads to your browser. Open it locally to use the integrated reader, keyboard navigation, chapter sidebar, and scroll progress bar.

Use the **✖ Cancel** button if you need to abort an in-progress run. Active network requests are aborted immediately and the UI resets.

## Settings reference
Open the **⚙ Settings** tab inside the panel to tune behavior. Changes persist between sessions.

| Setting | Description | Default |
| --- | --- | --- |
| Batch Size | Number of simultaneous requests. Lower values are friendlier to the host but slower overall. | 5 |
| Delay Between Requests | Base delay (ms) before retrying a failed chapter. Uses exponential backoff under the hood. | 2000 |
| Max Retry Attempts | Maximum number of re-tries per chapter before marking it as failed. | 3 |
| Enable Detailed Logging | Toggle console/log overlay updates, reduce noise by disabling once stable. | Enabled |
| Compact Interface Mode | Shrinks spacing and fonts to better fit small screens. | Disabled |

Press **💾 Save Settings** to apply or **🔄 Reset Defaults** to restore the stock configuration.

## Logging & troubleshooting
- Click **🗂 Show Logs** to toggle the on-screen log window. Export the visible log with **📤 Export Logs** for bug reports.
- All logs are timestamped and categorized (INFO/WARN/ERROR/DEBUG). Check for extraction errors or retry warnings here before reporting scraping issues.
- Use the browser console for deeper debugging—Tampermonkey also pipes messages there with structured data payloads.

## HTML export anatomy
The generated reader bundles:
- A fixed navigation bar with the novel title, the current chapter title, and a button to open a chapter list sidebar.
- Scroll progress indicator and floating previous/next controls that respect keyboard shortcuts (`Ctrl` + `←/→`).
- Responsive layout tweaks for tablets/phones and print-friendly styling for offline archiving.

Feel free to re-style the template by editing the CSS and markup in `generateAndDownloadHTML()` if you want a bespoke reader.

## Development workflow
1. Clone this repository and open it in your editor.
2. Update [`NovelBin.me Chapter Aggregator Simplified.js`](./NovelBin.me%20Chapter%20Aggregator%20Simplified.js). The script is intentionally framework-free; keep functions self-contained to remain Tampermonkey friendly.
3. Increment the `@version` header when shipping user-facing changes so Tampermonkey users receive update prompts.
4. Use a local browser with the script installed to manually test against several NovelBin titles. Verify both full downloads and range selections, plus cancel/retry flows.
5. When modifying UI strings or icons, ensure matching ARIA labels remain intact for accessibility.

### Repository structure
```
novelbinaggregator/
├── NovelBin.me Chapter Aggregator Simplified.js  # primary user script
└── README.md                                     # this file
```

Additional design notes live in [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md).

## Contributing
Bug reports, feature suggestions, and pull requests are welcome! Please include exported logs or reproduction steps when reporting download failures. See [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for an overview of the major classes and helper utilities before diving in.

## License
No explicit license has been chosen yet. Until one is added, treat the contents as "all rights reserved" and request permission before redistribution.
