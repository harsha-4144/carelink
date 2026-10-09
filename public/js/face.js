// Optional face recognition (ENABLE_FACE=true). Uses face-api.js and models served from /models
// (run `npm run models` once). Only the 128-number descriptor leaves the browser, never the image.
const Face = (() => {
  let ready = false;
  let stream = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('face library missing (run npm run models)'));
      document.head.appendChild(s);
    });
  }

  async function ensure() {
    if (ready) return;
    if (typeof faceapi === 'undefined') await loadScript('/models/face-api.min.js');
    await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
    await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
    await faceapi.nets.faceRecognitionNet.loadFromUri('/models');
    ready = true;
  }

  async function startCamera(video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('camera not available');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
  }

  function stop() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  async function descriptor(video) {
    const r = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
    return r ? Array.from(r.descriptor) : null;
  }

  return { ensure, startCamera, stop, descriptor };
})();

// Called by app.js once a session exists and the server reports face_enabled.
async function initFaceTab() {
  const msg = $('face-msg');
  try {
    msg.textContent = 'Loading face models…';
    await Face.ensure();
    await Face.startCamera($('face-video'));
    msg.textContent = 'Point the camera at the patient\'s face, then tap Scan.';
    $('face-area').hidden = false;
  } catch (e) {
    msg.textContent = 'Face recognition unavailable (' + e.message + '). Use QR or CARELINK ID.';
    return;
  }
  $('face-scan').onclick = async () => {
    try {
      const d = await Face.descriptor($('face-video'));
      if (!d) { $('identify-msg').textContent = 'No face detected. Try again.'; return; }
      await identify('face', d);
      if (state.patient) Face.stop();
    } catch (e) { $('identify-msg').textContent = 'Face scan failed: ' + e.message; }
  };
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.tab !== 'face') Face.stop(); }));
}
