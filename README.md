<div align="center">

# Blobbo

### A tiny world of blobs, relationships, and emergent physics.

[![Play Blobbo](https://img.shields.io/badge/PLAY_BLOBBO-ff7a5c?style=for-the-badge&logoColor=white)](https://coveymatt.github.io/blobbo/)

## Scan to install

<a href="https://coveymatt.github.io/blobbo/">
  <img src="docs/install-qr.png" width="420" alt="QR code that opens Blobbo">
</a>

**iPhone or iPad:** Open in Safari, tap **Share**, then **Add to Home Screen**.  
**Android:** Open in Chrome and tap **Install** when prompted.

</div>

## About

Blobbo is a browser-first little world about relationships, physical communication, and emergent play. The main **Adventure** begins in a persistent meadow where four residents communicate through movement, sound, expression, and picture bubbles. What you do changes how they respond—and some changes remain when you return.

The original competitive physics prototype remains available from the main menu as **Arena**.

The same app works in a browser, installs to a phone or desktop, and remains playable offline after its first successful load.

## Development

The `main` branch deploys automatically to GitHub Pages through the included workflow. The service worker uses a network-first strategy so online players receive new releases promptly while the last working release remains available offline.

When changing the files listed in `service-worker.js`, increment `CACHE_NAME` before publishing.

## Adventure

- Move with WASD, arrow keys, or by dragging on a touchscreen
- Touch another Blobbo—or the seed—to form a temporary connection
- Use Space or ⚓ to anchor your Blobbo while pushing or pulling
- Carry the seed across the bridge and place it in the brown planting hole
- Observe faces, movement and picture bubbles; essential interactions do not require reading
- Progress is stored on the device

## Arena

- Move: WASD, arrow keys, or drag on touchscreens
- Anchor: Space or the anchor button
