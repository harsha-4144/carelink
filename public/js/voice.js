// Voice trigger using the Web Speech API. Everything is feature-detected: if the browser has
// no SpeechRecognition the mic button is hidden and SOS keeps working.
const Voice = (() => {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = Boolean(Ctor);
  let rec = null;
  let active = false;

  function listen(onTrigger, onState) {
    if (!supported || active) return;
    rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-IN';
    active = true;
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const text = ev.results[i][0].transcript.toLowerCase();
        if (/\b(emergency|help)\b/.test(text)) { stop(); onTrigger(text); return; }
      }
    };
    rec.onerror = (ev) => { active = false; onState('error', ev.error); };
    rec.onend = () => { if (active) { try { rec.start(); } catch (e) { active = false; onState('stopped'); } } else onState('stopped'); };
    try { rec.start(); onState('listening'); } catch (e) { active = false; onState('error', e.message); }
  }

  function stop() {
    active = false;
    if (rec) { try { rec.stop(); } catch (e) { /* already stopped */ } }
  }

  return { supported, listen, stop, get active() { return active; } };
})();
