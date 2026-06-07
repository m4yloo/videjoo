# Lightweight Video Previewer

## Problem Statement
Build a really simple, incredibly lightweight video previewer: input a link and it plays.
Example URL: tiki.aether.bar HLS (m3u8) stream.

## Architecture
- Frontend-only React app (no backend needed for previewing public URLs)
- hls.js for HLS (.m3u8) playback
- Native HTML5 <video> for MP4 / WebM / native formats
- Safari uses native HLS via canPlayType fallback

## Implemented (2026-02-07)
- Single-page previewer at `/` (VideoPreviewer.jsx)
- URL input + Play button + Clear button
- Auto-detects HLS vs native source
- Browser-native controls (play/pause, volume, fullscreen, speed via menu)
- Inline error display for invalid URLs / playback errors
- Clean dark mono-typography aesthetic with emerald accents

## Files
- /app/frontend/src/App.js
- /app/frontend/src/pages/VideoPreviewer.jsx
- hls.js added to package.json

## Backlog (P1/P2)
- Recently-played URL history (localStorage)
- Shareable links (?src=...)
- Picture-in-picture button
- Quality selector for multi-bitrate HLS
