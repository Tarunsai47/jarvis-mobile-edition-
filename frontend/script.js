
const chat = document.getElementById("chat");
const input = document.getElementById("msg");
const sendBtn = document.getElementById("send");

function add(text, who) {
  const d = document.createElement("div");
  d.className = "msg " + who;
  d.textContent = text;

  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;

  return d;
}

function sendMessage() {
  const t = input.value.trim();

  if (!t) return;

  add("YOU: " + t, "user");
  input.value = "";
  input.focus();

  sendBtn.disabled = true;

  const reply = add("J.A.R.V.I.S: Processing...", "ai");

  setTimeout(() => {
    reply.textContent =
      "J.A.R.V.I.S: Systems online. How may I assist you, Boss?";

    sendBtn.disabled = false;
    input.focus();
    chat.scrollTop = chat.scrollHeight;
  }, 1000);
}

sendBtn.addEventListener("click", sendMessage);

input.addEventListener("keydown", function (event) {
  if (event.key === "Enter") {
    event.preventDefault();
    sendMessage();
  }
});
