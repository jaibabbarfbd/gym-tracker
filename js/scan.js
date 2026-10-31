/* Barcode scanning with the phone camera. Uses the browser's own BarcodeDetector where it has one
   (Chrome on Android); elsewhere (iPhone, the Android app) a WebAssembly scanner is loaded from
   jsDelivr the first time someone scans. */
(function (root) {
  'use strict';
  const POLYFILL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/es/ponyfill.js';
  const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']; // what food packs use
  let stream = null;
  let timer = null;
  let run = 0; // bumped by stop(), so a scan that is still starting knows it was cancelled

  async function makeDetector() {
    if ('BarcodeDetector' in root) {
      try {
        const have = await root.BarcodeDetector.getSupportedFormats();
        const want = FORMATS.filter((f) => have.includes(f));
        if (want.length) return new root.BarcodeDetector({ formats: want });
      } catch (e) { /* use the WebAssembly scanner */ }
    }
    const { BarcodeDetector } = await import(POLYFILL);
    return new BarcodeDetector({ formats: FORMATS });
  }

  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  // Shows the back camera in `video` and calls onCode(code) once, with the first barcode it reads.
  async function start(video, onCode) {
    stop();
    const mine = run;
    const detector = await makeDetector();
    if (mine !== run) return;
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    if (mine !== run) return s.getTracks().forEach((t) => t.stop());
    stream = s;
    video.srcObject = s;
    await video.play();
    const tick = async () => {
      if (mine !== run) return;
      try {
        const found = video.readyState >= 2 ? await detector.detect(video) : [];
        const hit = found.find((b) => /^\d{8,14}$/.test(b.rawValue));
        if (hit && mine === run) {
          stop();
          return onCode(hit.rawValue);
        }
      } catch (e) { /* frame not ready yet */ }
      timer = setTimeout(tick, 200);
    };
    tick();
  }

  function stop() {
    run++;
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  root.GymScan = { supported, start, stop };
})(window);
