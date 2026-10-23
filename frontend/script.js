// ===== 1. API KEY SETUP =====
let API_KEY = localStorage.getItem('jarvis_key');
if (!API_KEY) {
  API_KEY = prompt('Enter your Gemini API Key:');
  if (API_KEY) localStorage.setItem('jarvis_key', API_KEY);
}

// ===== 2. MODEL DISCOVERY + FALLBACK =====
const MODEL_PREFERENCES = [
  "gemini-3.8-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash"
];

const chat = document.getElementById('chat');
const input = document.getElementById('msg');
const micBtn = document.getElementById('mic-btn');
const sendBtn = document.getElementById('send');

async function getAvailableModels() {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(API_KEY)}&pageSize=100`
  );
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(
      data.error?.message || "Could not retrieve available Gemini models."
    );
  }

  const models = (data.models || []).filter(model =>
    model.supportedGenerationMethods?.includes("generateContent")
  );

  const usable = models
    .filter(model => !/embedding|image|tts|audio|live|deprecated/i.test(model.name))
    .map(model => model.name.replace(/^models\//, ""));

  const preferred = MODEL_PREFERENCES.filter(name => usable.includes(name));
  const otherFlash = usable.filter(name =>
    /flash/i.test(name) && !preferred.includes(name)
  );

  return [...new Set([...preferred, ...otherFlash])];
}

// ===== 3. GEMINI BRAIN =====
async function callGemini(p) {
  if (!API_KEY) {
    throw new Error("Gemini API key is missing. Refresh the page and enter a valid key.");
  }

  const models = await getAvailableModels();

  if (!models.length) {
    throw new Error("Your API key has no available text-generation models. Check Google AI Studio access.");
  }

  let lastErr;

  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(API_KEY)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: "You are J.A.R.V.I.S., a helpful AI assistant. Keep responses clear, accurate, and concise."
              }]
            },
            contents: [{
              role: "user",
              parts: [{ text: p }]
            }]
          })
        }
      );

      const data = await response.json();

      if (!response.ok || data.error) {
        const message = data.error?.message || `HTTP ${response.status}`;
        lastErr = new Error(message);

        if (
          response.status === 404 ||
          response.status === 429 ||
          /high demand|temporar|quota|rate|unavailable|no longer available|deprecated|not found/i.test(message)
        ) {
          continue;
        }

        // Do not keep trying models if the key is invalid or access is denied.
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          throw lastErr;
        }

        continue;
      }

      const answer = (data.candidates?.[0]?.content?.parts || [])
        .map(part => part.text || "")
        .filter(Boolean)
        .join("\n");

      if (!answer) {
        lastErr = new Error("The model returned no text. Try another request.");
        continue;
      }

      return answer;
    } catch (error) {
      lastErr = error;

      if (/Failed to fetch|NetworkError/i.test(error.message)) {
        throw new Error("Network request failed. Check your connection and try again.");
      }

      if (/API key|permission|access denied|unauthorized|invalid argument/i.test(error.message)) {
        throw error;
      }
    }
  }

  throw new Error(
    "All available Gemini text models failed or are busy. Please wait briefly and try again. Details: " +
    (lastErr?.message || "No further details.")
  );
}

async function askGemini(p) {
  add('J.A.R.V.I.S: Thinking...', 'ai');

  try {
    const reply = await callGemini(p);

    if (chat && chat.lastChild) {
      chat.lastChild.innerText = 'J.A.R.V.I.S: ' + reply;
    }

    speak(reply);
  } catch (e) {
    if (chat && chat.lastChild) {
      chat.lastChild.innerText = 'J.A.R.V.I.S: ERROR - ' + e.message;
    }
  }
}

// ===== 4. SPEECH RECOGNITION =====
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SR && micBtn) {
  const rec = new SR();
  rec.lang = 'en-US';

  rec.onresult = (e) => {
    const t = e.results[0][0].transcript;
    add('YOU: ' + t, 'user');
    askGemini(t);
  };

  rec.onerror = (e) => {
    add('J.A.R.V.I.S: Voice input error - ' + e.error, 'ai');
  };

  micBtn.onclick = () => {
    try {
      rec.start();
      micBtn.innerText = 'LISTENING...';
    } catch (err) {
      console.error(err);
    }
  };

  rec.onend = () => {
    micBtn.innerText = '🎙';
  };
} else if (micBtn) {
  micBtn.disabled = true;
  micBtn.title = 'Voice input is not supported by this browser.';
}

// ===== 5. TEXT-TO-SPEECH =====
let voices = [];

function loadVoices() {
  if (typeof speechSynthesis !== 'undefined') {
    voices = speechSynthesis.getVoices();
  }
}

loadVoices();

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = loadVoices;
}

function speak(t) {
  if (typeof speechSynthesis === 'undefined') return;

  const u = new SpeechSynthesisUtterance(t);
  u.rate = 1.05;
  u.pitch = 0.85;

  const v = voices.find(v => v.lang.startsWith('en'));
  if (v) u.voice = v;

  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ===== 6. SEND BUTTON & ENTER KEY ACTION =====
function handleSend() {
  if (!input) return;

  const t = input.value.trim();
  if (!t) return;

  add('YOU: ' + t, 'user');
  input.value = '';
  askGemini(t);
}

if (sendBtn) {
  sendBtn.onclick = handleSend;
}

if (input) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  });
}

function add(t, w) {
  if (!chat) return;

  const d = document.createElement('div');
  d.className = 'msg ' + w;
  d.innerText = t;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}
