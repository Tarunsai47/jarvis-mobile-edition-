// ===== SECURE BACKEND CONNECTION =====
// API keys stay on the backend server; this browser only knows the backend URL.
function getJarvisBackendUrl() {
  let url = String(window.JARVIS_API_BASE_URL || '').trim();
  if (!url) {
    try { url = String(localStorage.getItem('jarvis_backend_url') || '').trim(); } catch (_) {}
  }
  if (!url) {
    url = String(prompt('Enter your deployed J.A.R.V.I.S backend URL (no API key):') || '').trim();
    if (url) {
      url = url.replace(/\/+$/, '');
      try { localStorage.setItem('jarvis_backend_url', url); } catch (_) {}
    }
  }
  return url.replace(/\/+$/, '');
}

async function backendPost(path, body) {
  const base = getJarvisBackendUrl();
  if (!base) {
    throw new Error('Backend URL is not configured. Deploy the backend and enter its URL; never enter an API key here.');
  }
  let response;
  try {
    response = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (_) {
    throw new Error('Cannot reach the J.A.R.V.I.S backend. Check the backend URL and deployment status.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Backend request failed (HTTP ' + response.status + ').');
  if (!data.reply) throw new Error('The AI provider returned an empty reply.');
  return data.reply;
}

// ===== 2. MEMORY SYSTEM =====
let MEMORY = JSON.parse(localStorage.getItem('jarvis_memory') || '[]'); 
function saveMemory(){ 
  localStorage.setItem('jarvis_memory', JSON.stringify(MEMORY)); 
} 

const chat = document.getElementById('chat'); 
const input = document.getElementById('msg'); 
const micBtn = document.getElementById('mic-btn'); 
const clearBtn = document.getElementById('clear-btn'); 
const camBtn = document.getElementById('cam-btn'); 
const imgInput = document.getElementById('img-input'); 

MEMORY.forEach(m => add((m.role === 'user' ? 'YOU: ' : 'J.A.R.V.I.S: ') + m.text, m.role === 'user' ? 'user' : 'ai')); 

// ===== 3. GEMINI BRAIN (MEMORY INTEGRATED) ===== 
async function callGemini(p) {
  const messages = MEMORY.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text
  }));
  // askGemini already adds the current user message to MEMORY.
  return backendPost('/api/chat', { messages });
}

// ===== 4. VISION ENGINE (EYES) ===== 
if(camBtn && imgInput){ 
  camBtn.onclick = () => imgInput.click(); 
  imgInput.onchange = () => { 
    const file = imgInput.files[0]; 
    if(!file) return; 
    const reader = new FileReader(); 
    reader.onload = () => { 
      const base64 = reader.result.split(',')[1]; 
      const q = input.value.trim() || 'What do you see? Describe briefly.'; 
      add('YOU: [IMAGE] ' + q, 'user'); 
      input.value = ''; 
      askVision(base64, file.type, q); 
    }; 
    reader.readAsDataURL(file); 
  }; 
} 

async function askVision(base64, mime, q){
  const message = add('J.A.R.V.I.S: Analyzing image...', 'ai');
  try {
    const reply = await backendPost('/api/vision', {
      prompt: q,
      imageBase64: base64,
      mimeType: mime || 'image/jpeg',
      history: MEMORY.slice(-8).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text
      }))
    });
    message.innerText = 'J.A.R.V.I.S: ' + reply;
    MEMORY.push({ role: 'user', text: '[Image] ' + q });
    MEMORY.push({ role: 'model', text: reply });
    MEMORY = MEMORY.slice(-20);
    saveMemory();
    speak(reply);
  } catch (err) {
    message.innerText = 'J.A.R.V.I.S: ' + friendlyApiError(err);
  }
}

// ===== 5. VOICE & UTILS ===== 
const SR = window.SpeechRecognition || window.webkitSpeechRecognition; 
if(SR && micBtn){ 
  const rec = new SR(); 
  rec.lang = 'en-US'; 
  rec.onresult = (e) => {
    const t = e.results[0][0].transcript;
    add('YOU: ' + t, 'user');
    askGemini(t);
  }; 
  micBtn.onclick = () => {
    rec.start();
    micBtn.innerText = 'LISTENING...';
  }; 
  rec.onend = () => {
    micBtn.innerText = '🎙️';
  }; 
} 

// ===== SINGLE TONY STARK-INSPIRED VOICE =====
// Browser speech voices are device-provided; this selects the closest available English male-sounding voice.
const voiceSelect = document.getElementById('jarvis-voice');
const testVoiceBtn = document.getElementById('test-voice');
const voiceStatus = document.getElementById('voice-status');
const SAVED_VOICE_KEY = 'jarvis_selected_voice_v1';
let voices = [];
let chosenVoice = null;

function chooseTonyStyleVoice(list) {
  const english = list.filter(v => /^en(-|$)/i.test(v.lang));
  const pool = english.length ? english : list;
  const maleHints = /male|daniel|arthur|oliver|george|ryan|david|james|fred|guy|andrew|brian|tom|alex/i;
  const british = pool.filter(v => /en-GB/i.test(v.lang));
  return british.find(v => maleHints.test(v.name))
    || pool.find(v => maleHints.test(v.name))
    || british[0]
    || pool.find(v => /en-US/i.test(v.lang))
    || pool[0]
    || null;
}

function loadVoices() {
  if (!('speechSynthesis' in window)) {
    if (voiceStatus) voiceStatus.textContent = 'This browser does not support speech synthesis.';
    if (voiceSelect) voiceSelect.disabled = true;
    if (testVoiceBtn) testVoiceBtn.disabled = true;
    return;
  }

  voices = speechSynthesis.getVoices() || [];
  if (!voices.length) {
    if (voiceStatus) voiceStatus.textContent = 'Loading device voice… If this remains empty, enable text-to-speech voices in device settings.';
    return;
  }

  chosenVoice = chooseTonyStyleVoice(voices);
  if (!chosenVoice) {
    if (voiceStatus) voiceStatus.textContent = 'No browser voice is available on this device.';
    if (voiceSelect) voiceSelect.disabled = true;
    if (testVoiceBtn) testVoiceBtn.disabled = true;
    return;
  }

  // One voice only, as requested.
  if (voiceSelect) {
    voiceSelect.innerHTML = '';
    const option = document.createElement('option');
    option.value = chosenVoice.voiceURI;
    option.textContent = 'J.A.R.V.I.S — Tony Stark-inspired (' + chosenVoice.name + ', ' + chosenVoice.lang + ')';
    voiceSelect.appendChild(option);
    voiceSelect.value = chosenVoice.voiceURI;
    voiceSelect.disabled = false;
  }

  try { localStorage.setItem(SAVED_VOICE_KEY, chosenVoice.voiceURI); } catch (_) {}
  if (voiceStatus) voiceStatus.textContent =
    'Single voice: ' + chosenVoice.name + ' (' + chosenVoice.lang + '). Natural, confident delivery. The actual movie voice is not included.';
}

if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
  setTimeout(loadVoices, 700);
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  if (!chosenVoice) loadVoices();
  if (!chosenVoice) {
    if (voiceStatus) voiceStatus.textContent = 'No speech voice is ready. Check your device text-to-speech settings.';
    return;
  }

  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = chosenVoice;
  utterance.lang = chosenVoice.lang || 'en-GB';
  utterance.rate = 0.96;
  utterance.pitch = 0.88;
  utterance.volume = 1;
  speechSynthesis.speak(utterance);
}

if (testVoiceBtn) {
  testVoiceBtn.addEventListener('click', () => {
    if (!chosenVoice) loadVoices();
    if (!chosenVoice) {
      if (voiceStatus) voiceStatus.textContent = 'No voice available. Enable text-to-speech in device settings and reopen the page.';
      return;
    }
    speak('Hello, sir. All systems are online. How may I assist you today?');
    if (voiceStatus) voiceStatus.textContent = 'Testing ' + chosenVoice.name + '. Voice quality depends on your device.';
  });
}

const sendBtn = document.getElementById('send');
if(sendBtn) {
  sendBtn.onclick = () => { 
    const t = input.value.trim(); 
    if(!t || jarvisBusy) return; 
    add('YOU: ' + t, 'user'); 
    input.value = ''; 
    askGemini(t); 
  }; 
}

if (input) {
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (sendBtn) sendBtn.click();
    }
  });
}

if(clearBtn){ 
  clearBtn.onclick = () => { 
    MEMORY = []; 
    saveMemory(); 
    chat.innerHTML = ''; 
    add('SYSTEM: Memory cleared.', 'ai'); 
  }; 
} 

function add(t, w){
  const d = document.createElement('div');
  d.className = 'msg ' + w;
  d.innerText = t;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
  return d;
}
