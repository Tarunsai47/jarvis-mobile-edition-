 // ===== 1. API KEY & SMART MODELS =====
let API_KEY = localStorage.getItem('jarvis_key');
if(!API_KEY) { 
  API_KEY = prompt('Enter your Gemini API Key:'); 
  if(API_KEY) localStorage.setItem('jarvis_key', API_KEY); 
} 

// ===== MODEL DISCOVERY =====
// Use the models actually enabled for this API key instead of hard-coding retired IDs.
const MODEL_PREFERENCES = [
  "gemini-3.8-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash"
];

let availableModelsCache = null;
const MODEL_CACHE_KEY = "jarvis_models_cache_v1";

async function getAvailableModels() {
  if (!API_KEY) throw new Error("Gemini API key is missing. Refresh the page and enter a valid key.");
  if (availableModelsCache) return availableModelsCache;

  // Reuse the last successful model list so normal chats don't repeatedly discover models.
  try {
    const saved = JSON.parse(localStorage.getItem(MODEL_CACHE_KEY) || "null");
    if (Array.isArray(saved) && saved.length) {
      availableModelsCache = saved;
      return saved;
    }
  } catch (_) {}

  const allModels = [];
  let pageToken = "";

  do {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("key", API_KEY);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `Could not list models (HTTP ${response.status}).`);
    }

    allModels.push(...(data.models || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  const supported = allModels
    .filter(model =>
      model.supportedGenerationMethods?.includes("generateContent") &&
      !/embedding|image|tts|audio|live|deprecated/i.test(model.name || "")
    )
    .map(model => (model.name || "").replace(/^models\//, ""))
    .filter(Boolean);

  const preferred = MODEL_PREFERENCES.filter(name => supported.includes(name));
  const otherFlash = supported.filter(name => /flash/i.test(name) && !preferred.includes(name));
  const otherText = supported.filter(name =>
    /gemini/i.test(name) &&
    !/image|audio|live|tts|embedding/i.test(name) &&
    !preferred.includes(name) &&
    !otherFlash.includes(name)
  );

  availableModelsCache = [...new Set([...preferred, ...otherFlash, ...otherText])];

  if (!availableModelsCache.length) {
    throw new Error("Google returned no models supporting generateContent for this API key.");
  }

  // Keep the fallback list short to avoid slow serial retries.
  availableModelsCache = availableModelsCache.slice(0, 4);
  try { localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(availableModelsCache)); } catch (_) {}
  return availableModelsCache;
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
  const contents = MEMORY.slice(-8).map(m => ({role: m.role, parts: [{text: m.text}]})); 
  contents.push({role: 'user', parts: [{text: p}]}); 

  let lastErr; 
  const models = (await getAvailableModels()).slice(0, 3);
  for (const m of models) { 
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);
    try { 
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${API_KEY}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        signal: controller.signal,
        body: JSON.stringify({contents: contents})
      }); 
      
      const data = await res.json(); 
      if(data.error){ 
        lastErr = new Error(data.error.message); 
        if(/high demand|temporar|quota|rate|unavailable|deprecated|not found|not supported|no longer available|overload/i.test(data.error.message) || res.status === 404 || res.status === 429 || res.status >= 500) continue; 
        throw lastErr; 
      } 
      const answer = (data.candidates?.[0]?.content?.parts || []).map(part => part.text || '').filter(Boolean).join('\n');
      if(answer) return answer;
      lastErr = new Error(data.candidates?.[0]?.finishReason || 'Model returned no text.'); 
    } catch(e){ 
      lastErr = e.name === "AbortError"
        ? new Error("Request timed out after 18 seconds. Please try again.")
        : e; 
    } finally {
      clearTimeout(timeoutId);
    }
  } 
  throw lastErr || new Error("No compatible Gemini model responded.");
} 

let jarvisBusy = false;
async function askGemini(p) {
  if (jarvisBusy) return;
  jarvisBusy = true;
  if (sendBtn) sendBtn.disabled = true;
  const thinkingMessage = add('J.A.R.V.I.S: Thinking...', 'ai');
  try { 
    const reply = await callGemini(p); 
    MEMORY.push({role: 'user', text: p}); 
    MEMORY.push({role: 'model', text: reply}); 
    saveMemory(); 
    if (thinkingMessage) thinkingMessage.innerText = 'J.A.R.V.I.S: ' + reply;
    speak(reply); 
  } catch(e){ 
    if (thinkingMessage) thinkingMessage.innerText = 'J.A.R.V.I.S: ERROR - ' + e.message; 
  } finally {
    jarvisBusy = false;
    if (sendBtn) sendBtn.disabled = false;
  }
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
  add('J.A.R.V.I.S: Analyzing image...', 'ai'); 
  let lastErr; 
  for(const m of await getAvailableModels()){ 
    try { 
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${API_KEY}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"}, 
        body: JSON.stringify({
          contents: [{
            parts: [
              {text: q},
              {inline_data: {mime_type: mime, data: base64}}
            ]
          }]
        })
      }); 

      const data = await res.json(); 
      if(data.error){ 
        lastErr = new Error(data.error.message); 
        if(/high demand|temporar|quota|rate|unavailable|deprecated|not found|not supported|no longer available/i.test(data.error.message)) continue; 
        throw lastErr; 
      } 
      const reply = data.candidates[0].content.parts[0].text; 
      chat.lastChild.innerText = 'J.A.R.V.I.S: ' + reply; 
      speak(reply); 
      return; 
    } catch(e){ 
      lastErr = e; 
    } 
  } 
  chat.lastChild.innerText = 'J.A.R.V.I.S: ERROR - ' + lastErr.message; 
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

// ===== VOICE SELECTION: TONY STARK-INSPIRED =====
const voiceSelect = document.getElementById('jarvis-voice');
const testVoiceBtn = document.getElementById('test-voice');
const voiceStatus = document.getElementById('voice-status');
const SAVED_VOICE_KEY = 'jarvis_selected_voice_v1';
let voices = [];
let selectedVoiceURI = localStorage.getItem(SAVED_VOICE_KEY) || '';

function loadVoices() {
  if (typeof speechSynthesis === 'undefined') {
    if (voiceStatus) voiceStatus.textContent = 'Speech synthesis is not supported in this browser.';
    if (voiceSelect) voiceSelect.disabled = true;
    if (testVoiceBtn) testVoiceBtn.disabled = true;
    return;
  }

  voices = speechSynthesis.getVoices() || [];
  if (!voiceSelect) return;

  const previous = selectedVoiceURI || voiceSelect.value;
  voiceSelect.innerHTML = '';

  const englishVoices = voices.filter(v => /^en(-|$)/i.test(v.lang));
  const choices = englishVoices.length ? englishVoices : voices;

  if (!choices.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No browser voices available';
    voiceSelect.appendChild(option);
    voiceSelect.disabled = true;
    if (voiceStatus) voiceStatus.textContent = 'No voices are available yet. Try reopening this page or enabling text-to-speech voices in your device settings.';
    return;
  }

  voiceSelect.disabled = false;
  choices.forEach(v => {
    const option = document.createElement('option');
    option.value = v.voiceURI;
    const label = v.name + ' (' + v.lang + ')' + (v.default ? ' — default' : '');
    option.textContent = label;
    voiceSelect.appendChild(option);
  });

  const preferred = choices.find(v => v.voiceURI === previous)
    || choices.find(v => /en-GB/i.test(v.lang) && /male|daniel|arthur|oliver|george|ryan/i.test(v.name))
    || choices.find(v => /en-GB/i.test(v.lang))
    || choices.find(v => /^en/i.test(v.lang))
    || choices[0];

  voiceSelect.value = preferred.voiceURI;
  selectedVoiceURI = preferred.voiceURI;
  try { localStorage.setItem(SAVED_VOICE_KEY, selectedVoiceURI); } catch (_) {}

  if (voiceStatus) {
    voiceStatus.textContent = 'Using ' + preferred.name + '. Choose another available voice and tap TEST VOICE to preview it.';
  }
}

if (typeof speechSynthesis !== 'undefined') {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

if (voiceSelect) {
  voiceSelect.addEventListener('change', () => {
    selectedVoiceURI = voiceSelect.value;
    try { localStorage.setItem(SAVED_VOICE_KEY, selectedVoiceURI); } catch (_) {}
    const chosen = voices.find(v => v.voiceURI === selectedVoiceURI);
    if (voiceStatus) voiceStatus.textContent = chosen
      ? 'Selected: ' + chosen.name + '. Tap TEST VOICE to hear a preview.'
      : 'This voice is not currently available.';
  });
}

function speak(t) {
  if (typeof speechSynthesis === 'undefined') {
    if (voiceStatus) voiceStatus.textContent = 'Text-to-speech is not supported in this browser.';
    return;
  }
  const chosen = voices.find(v => v.voiceURI === (voiceSelect ? voiceSelect.value : selectedVoiceURI));
  if (!chosen) {
    if (voiceStatus) voiceStatus.textContent = 'The selected voice is unavailable. Choose a voice from the list.';
    return;
  }

  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.voice = chosen;
  u.lang = chosen.lang || 'en-US';
  u.rate = 0.98;
  u.pitch = 0.96;
  u.volume = 1;
  speechSynthesis.speak(u);
}

if (testVoiceBtn) {
  testVoiceBtn.addEventListener('click', () => {
    const chosen = voices.find(v => v.voiceURI === (voiceSelect ? voiceSelect.value : selectedVoiceURI));
    if (!chosen) {
      if (voiceStatus) voiceStatus.textContent = 'No selected voice is available. Check your device/browser speech voices.';
      return;
    }
    speak("Hello, sir. All systems are online. How may I assist you today?");
    if (voiceStatus) voiceStatus.textContent = 'Previewing ' + chosen.name + ' (' + chosen.lang + '). The exact sound depends on your device.';
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
}
