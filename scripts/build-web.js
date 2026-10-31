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

// Write version.json into www/ so the APK knows its own build number.
// BUILD_NUMBER is set by the CI workflows (the commit count, same for the APK and the website); 0 locally.
const buildNumber = parseInt(process.env.BUILD_NUMBER || '0', 10);
const versionJson = JSON.stringify({ build: buildNumber });
fs.writeFileSync(path.join(OUT, 'version.json'), versionJson);
// Also write to root so GitHub Pages serves the latest version for update checks.
fs.writeFileSync(path.join(ROOT, 'version.json'), versionJson);
console.log(`Copied ${ENTRIES.length} entries to www/  |  version: build ${buildNumber}`);
