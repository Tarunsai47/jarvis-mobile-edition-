// ===== 1. API KEY SETUP =====
// API keys in frontend code are visible to visitors. For production, use a backend.
let API_KEY = localStorage.getItem("jarvis_key");

if (!API_KEY) {
  API_KEY = prompt("Enter your Gemini API Key:");
  if (API_KEY && API_KEY.trim()) {
    API_KEY = API_KEY.trim();
    localStorage.setItem("jarvis_key", API_KEY);
  } else {
    API_KEY = "";
  }
}

// ===== 2. MODEL DISCOVERY + FALLBACK =====
const MODEL_PREFERENCES = [
  "gemini-3.8-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash"
];

const chat = document.getElementById("chat");
const input = document.getElementById("msg");
const micBtn = document.getElementById("mic-btn");
const sendBtn = document.getElementById("send");

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Gemini returned an invalid response.");
  }
}

async function getAvailableModels() {
  if (!API_KEY) {
    throw new Error("Gemini API key is missing. Refresh the page and enter a valid key.");
  }

  const models = [];
  let pageToken = "";

  do {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("key", API_KEY);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url.toString());
    const data = await readJson(response);

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `Could not list models (HTTP ${response.status}).`);
    }

    models.push(...(data.models || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  const usable = models
    .filter(model =>
      model.supportedGenerationMethods?.includes("generateContent") &&
      !/embedding|image|tts|audio|live|deprecated/i.test(model.name || "")
    )
    .map(model => (model.name || "").replace(/^models\//, ""))
    .filter(Boolean);

  const preferred = MODEL_PREFERENCES.filter(name => usable.includes(name));
  const otherFlash = usable.filter(name =>
    /flash/i.test(name) && !preferred.includes(name)
  );
  const otherGemini = usable.filter(name =>
    /gemini/i.test(name) &&
    !/pro|image|audio|live|tts|embedding/i.test(name) &&
    !preferred.includes(name) &&
    !otherFlash.includes(name)
  );

  return [...new Set([...preferred, ...otherFlash, ...otherGemini])];
}

function isRetryableModelError(status, message) {
  return status === 404 ||
    status === 429 ||
    status >= 500 ||
    /high demand|temporar|quota|rate.?limit|unavailable|no longer available|deprecated|not found|overload/i.test(message);
}

// ===== 3. GEMINI BRAIN =====
async function callGemini(promptText) {
  const models = await getAvailableModels();

  if (!models.length) {
    throw new Error("No compatible text-generation models were found for this API key.");
  }

  let lastError = null;

  for (const model of models) {
    let response;

    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(API_KEY)}`,
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
              parts: [{ text: promptText }]
            }]
          })
        }
      );
    } catch {
      throw new Error("Network request failed. Check your internet connection and try again.");
    }

    const data = await readJson(response);

    if (!response.ok || data.error) {
      const message = data.error?.message || `HTTP ${response.status}`;
      lastError = new Error(message);

      if (isRetryableModelError(response.status, message)) {
        continue;
      }

      throw lastError;
    }

    const answer = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .filter(Boolean)
      .join("\n");

    if (answer) return answer;

    lastError = new Error(
      "The model returned no text. " +
      (data.candidates?.[0]?.finishReason || "Try another request.")
    );
  }

  throw new Error(
    "No available model could answer right now. Wait a little and try again. Details: " +
    (lastError?.message || "No further details.")
  );
}

async function askGemini(promptText) {
  const message = add("J.A.R.V.I.S: Thinking...", "ai");

  try {
    const reply = await callGemini(promptText);
    if (message) message.innerText = "J.A.R.V.I.S: " + reply;
    speak(reply);
  } catch (error) {
    if (message) message.innerText = "J.A.R.V.I.S: ERROR - " + error.message;
  }
}

// ===== 4. SPEECH RECOGNITION =====
const SpeechRecognitionAPI =
  window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognitionAPI && micBtn) {
  const recognition = new SpeechRecognitionAPI();
  recognition.lang = "en-US";

  recognition.onresult = event => {
    const transcript = event.results[0][0].transcript;
    add("YOU: " + transcript, "user");
    askGemini(transcript);
  };

  recognition.onerror = event => {
    add("J.A.R.V.I.S: Voice input error - " + event.error, "ai");
  };

  micBtn.onclick = () => {
    try {
      recognition.start();
      micBtn.innerText = "LISTENING...";
    } catch (error) {
      console.error("Speech recognition:", error);
    }
  };

  recognition.onend = () => {
    micBtn.innerText = "🎙";
  };
} else if (micBtn) {
  micBtn.disabled = true;
  micBtn.title = "Voice input is not supported by this browser.";
}

// ===== 5. TEXT-TO-SPEECH =====
let voices = [];

function loadVoices() {
  if ("speechSynthesis" in window) voices = speechSynthesis.getVoices();
}

loadVoices();

if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = loadVoices;
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  utterance.pitch = 0.85;

  const voice = voices.find(item => item.lang && item.lang.startsWith("en"));
  if (voice) utterance.voice = voice;

  speechSynthesis.speak(utterance);
}

// ===== 6. SEND BUTTON + ENTER KEY =====
function handleSend() {
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  add("YOU: " + text, "user");
  input.value = "";
  askGemini(text);
}

if (sendBtn) sendBtn.onclick = handleSend;

if (input) {
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSend();
    }
  });
}

// ===== 7. CHAT MESSAGE HELPER =====
function add(text, role) {
  if (!chat) return null;

  const element = document.createElement("div");
  element.className = "msg " + role;
  element.innerText = text;
  chat.appendChild(element);
  chat.scrollTop = chat.scrollHeight;

  return element;
}
