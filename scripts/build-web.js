// Copies the web app into www/, which Capacitor packages into the Android app.
// The web files stay at the repo root so `node server.js` and static hosting keep working.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');
const ENTRIES = ['index.html', 'privacypolicy.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'fonts', 'icons'];

fs.rmSync(OUT, { recursive: true, force: true });
for (const entry of ENTRIES) {
  fs.cpSync(path.join(ROOT, entry), path.join(OUT, entry), { recursive: true });
}
console.log(`Copied ${ENTRIES.length} entries to www/`);
