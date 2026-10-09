// Downloads face-api.js and its model weights into public/models (gitignored).
// Exit code 1 on failure: leave ENABLE_FACE=false in that case.
const fs = require('fs');
const path = require('path');

const WEIGHTS = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/';
const LIB = 'https://unpkg.com/face-api.js@0.22.2/dist/face-api.min.js';
const MODELS = ['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'];
const out = path.join(__dirname, '..', 'public', 'models');

async function get(url, name) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  fs.writeFileSync(path.join(out, name), Buffer.from(await r.arrayBuffer()));
  console.log('ok', name);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  await get(LIB, 'face-api.min.js');
  for (const m of MODELS) {
    const manifestName = `${m}-weights_manifest.json`;
    await get(WEIGHTS + manifestName, manifestName);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, manifestName), 'utf8'));
    for (const group of manifest) for (const shard of group.paths) await get(WEIGHTS + shard, shard);
  }
  console.log('Models ready. Set ENABLE_FACE=true in .env to use them.');
})().catch((e) => { console.error('Model download failed:', e.message, '\nLeave ENABLE_FACE=false.'); process.exit(1); });
