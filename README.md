<div align="center">

# Blobbo

### A tiny world of blobs, relationships, and emergent physics.

[![Play Blobbo](https://img.shields.io/badge/PLAY_BLOBBO-ff7a5c?style=for-the-badge&logoColor=white)](https://coveymatt.github.io/blobbo/)

## Scan to install

<a href="https://coveymatt.github.io/blobbo/">
  <img src="docs/install-qr.svg" width="420" alt="QR code that opens Blobbo">
</a>

**iPhone or iPad:** Open in Safari, tap **Share**, then **Add to Home Screen**.  
**Android:** Open in Chrome and tap **Install** when prompted.

</div>

## About

Blobbo is a browser-first experiment in emergent play. Blobs move, grow, collide, form temporary tethers, and respond to a hazardous environment. The same app works in a browser, installs to a phone or desktop, and remains playable offline after its first successful load.

## Development

The `main` branch deploys automatically to GitHub Pages through the included workflow. The service worker uses a network-first strategy so online players receive new releases promptly while the last working release remains available offline.

When changing the files listed in `service-worker.js`, increment `CACHE_NAME` before publishing.

## Controls

- Move: WASD, arrow keys, or drag on touchscreens
- Anchor: Space or the anchor button

