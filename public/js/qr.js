// QR scanning through html5-qrcode (loaded from a CDN). If the library or camera is unavailable
// the caller gets a readable message and the manual CARELINK ID tab keeps working.
const QrScan = (() => {
  let scanner = null;

  async function start(elementId, onScan, onProblem) {
    if (typeof Html5Qrcode === 'undefined') { onProblem('QR scanner library could not load. Use "Enter CARELINK ID" instead.'); return; }
    try {
      scanner = new Html5Qrcode(elementId);
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, (text) => { stop(); onScan(text); }, () => {});
    } catch (e) {
      scanner = null;
      onProblem('Camera not available (' + (e && e.message ? e.message : e) + '). Use "Enter CARELINK ID" instead.');
    }
  }

  async function stop() {
    if (!scanner) return;
    const s = scanner;
    scanner = null;
    try { await s.stop(); s.clear(); } catch (e) { /* already stopped */ }
  }

  return { start, stop };
})();
