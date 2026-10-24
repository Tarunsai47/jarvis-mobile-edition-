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
  const contents = MEMORY.slice(-4).map(m => ({
    role: m.role,
    parts: [{ text: m.text }]
  }));
  contents.push({ role: 'user', parts: [{ text: p }] });

  const lastWorkingKey = 'jarvis_last_working_model_v1';
  const savedModel = localStorage.getItem(lastWorkingKey);
  let models = savedModel ? [savedModel] : await getAvailableModels();
  let fallbackAttempted = false;
  let lastErr;

  // Fast path: immediately use the last model that successfully answered.
  // Only discover/try alternatives if that model fails.
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(API_KEY)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents,
            generationConfig: { temperature: 0.5, maxOutputTokens: 400 }
          })
        }
      );
      const data = await res.json();

      if (!res.ok || data.error) {
        const message = data.error?.message || `HTTP ${res.status}`;
        lastErr = new Error(message);
        const canRetry = res.status === 404 || res.status === 429 || res.status >= 500 ||
          /high demand|temporar|quota|rate|unavailable|deprecated|not found|not supported|no longer available|overload/i.test(message);

        // If the saved model fails, discover compatible alternatives once.
        if (savedModel && !fallbackAttempted && i === 0 && canRetry) {
          fallbackAttempted = true;
          const discovered = await getAvailableModels();
          models = discovered.filter(name => name !== savedModel).slice(0, 2);
          i = -1;
          continue;
        }
        if (canRetry && i < models.length - 1) continue;
        throw lastErr;
      }

      const answer = (data.candidates?.[0]?.content?.parts || [])
        .map(part => part.text || '')
        .filter(Boolean)
        .join('\n');

      if (answer) {
        try { localStorage.setItem(lastWorkingKey, model); } catch (_) {}
        return answer;
      }

      lastErr = new Error(data.candidates?.[0]?.finishReason || 'The model returned no text.');
      if (savedModel && !fallbackAttempted && i === 0) {
        fallbackAttempted = true;
        const discovered = await getAvailableModels();
        models = discovered.filter(name => name !== savedModel).slice(0, 2);
        i = -1;
        continue;
      }
      if (i < models.length - 1) continue;
      throw lastErr;
    } catch (err) {
      lastErr = err.name === 'AbortError'
        ? new Error('J.A.R.V.I.S timed out. Please try again.')
        : err;
      if (savedModel && !fallbackAttempted && i === 0 && !/timed out/i.test(lastErr.message)) {
        fallbackAttempted = true;
        const discovered = await getAvailableModels();
        models = discovered.filter(name => name !== savedModel).slice(0, 2);
        i = -1;
        continue;
      }
      if (i < models.length - 1) continue;
      throw lastErr;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastErr || new Error('No compatible Gemini model responded.');
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
