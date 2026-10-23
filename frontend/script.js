// ===== 1. API KEY SETUP =====
let API_KEY = localStorage.getItem('jarvis_key');
if (!API_KEY) {
  API_KEY = prompt('Enter your Gemini API Key:');
  if (API_KEY) localStorage.setItem('jarvis_key', API_KEY);
}

// ===== 2. SMART MODELS =====
const MODELS = ["gemini-3.8-flash"];

const chat = document.getElementById('chat');
const input = document.getElementById('msg');
const micBtn = document.getElementById('mic-btn');
const sendBtn = document.getElementById('send');

// ===== 3. GEMINI BRAIN =====
async function callGemini(p) {
  let lastErr;
  for (const m of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: "You are J.A.R.V.I.S., an advanced AI assistant. Keep responses helpful, concise, and smart." }]
            },
            contents: [{ parts: [{ text: p }] }]
          })
        }
      );
      const data = await res.json();
      if (data.error) {
        lastErr = new Error(data.error.message);
        if (/high demand|temporar|quota|rate|unavailable|no longer available|deprecated/i.test(data.error.message)) {
          continue;
        }
        throw lastErr;
      }
      return data.candidates[0].content.parts[0].text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
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
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
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
