# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Extension (Manifest V3) that allows users to select a screen region, sends the screenshot to Google Gemini API for OCR, and displays results in an overlay on the page.

## Loading the Extension

No build step required. Load directly in Chrome:
1. Open `chrome://extensions/`
2. Enable Developer Mode
3. Click "Load unpacked" → select this directory

After any file change, click the refresh button on `chrome://extensions/` for the extension to reload.

## Architecture

### Message Flow

```
Popup → content.js (startCapture) → user drags selection
→ content.js → background.js (captureAndOcr) → chrome.tabs.captureVisibleTab()
→ background.js crops via OffscreenCanvas (DPR-aware)
→ background.js calls Gemini API
→ background.js returns text → content.js renders overlay
```

### Key Files

- **`background.js`** — Service Worker. Handles two responsibilities: (1) screenshot capture + DPR-scaled cropping using `OffscreenCanvas`, (2) Gemini API requests. Listens for `captureAndOcr` messages.

- **`content.js`** — Injected into all pages. Manages (1) fullscreen overlay + mouse drag selection UI, (2) result panel rendering with basic Markdown support (tables, code blocks, bold). Self-contained IIFE with `window.__ocrContentLoaded` guard against double injection.

- **`content.css`** — Styles for the selection overlay and result panel. Uses `z-index: 2147483646/47` to stay above page content.

- **`popup/popup.js`** — Checks `chrome.storage.sync` for API key, shows configured/unconfigured state, sends `startCapture` message to content.js. Falls back to `chrome.scripting.executeScript` if content script isn't loaded.

- **`options/options.js`** — Saves `apiKey`, `model`, and `prompt` to `chrome.storage.sync`. Default model: `gemini-2.5-flash`.

### Critical Implementation Details

**DPR Handling**: `captureVisibleTab` returns a physical-pixel image. `content.js` sends `devicePixelRatio` with the CSS-pixel rect. `background.js` multiplies all coordinates by DPR before cropping:
```js
x: Math.round((rect.x + rect.scrollX) * dpr)
```

**Overlay hide before screenshot**: The selection overlay uses `visibility: hidden` (not `display: none`) before calling `captureVisibleTab` to avoid layout reflow.

**Gemini API endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}` with `inline_data` base64 image. 30-second timeout via `AbortController`.

**Storage keys**: `apiKey`, `model`, `prompt` — all in `chrome.storage.sync`.
