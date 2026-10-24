# J.A.R.V.I.S Mobile Edition

The frontend is hosted on GitHub Pages. AI requests now go through a small Node.js backend so API keys are not stored in browser JavaScript.

## AI provider fallback

- Primary: Google Gemini (default model: `gemini-2.5-flash`)
- Backup: OpenAI API (default model: `gpt-4o-mini`)
- When Gemini fails, including quota/rate-limit errors, the backend tries OpenAI if its key is configured.
- Text chat and image analysis use the same backend and fallback strategy.

## Deploy the backend (Render example)

1. Push this repository to GitHub (the backend files are in the repository root: `server.js` and `package.json`).
2. In Render, create a **New Web Service** and connect this repository.
3. Use the repository root as the root directory, build command `npm install`, and start command `npm start`.
4. In the service's **Environment** settings, add:
   - `GEMINI_API_KEY` — your Gemini API key
   - `OPENAI_API_KEY` — your OpenAI API key (needed for fallback)
   - `FRONTEND_ORIGIN` — `https://tarunsai47.github.io`
   - Optional: `GEMINI_MODEL` = `gemini-2.5-flash`
   - Optional: `OPENAI_MODEL` = `gpt-4o-mini`
5. Deploy the service and open its `/health` URL. It should report `status: online` and show which providers are configured (it never returns the keys).
6. Copy the deployed backend base URL, for example `https://your-service-name.onrender.com` (do not add `/api/chat`).
7. In `frontend/config.js`, set `window.JARVIS_API_BASE_URL` to that base URL, then commit and push. Example:
   `window.JARVIS_API_BASE_URL = "https://your-service-name.onrender.com";`
8. Open the GitHub Pages site and test a text question and image analysis.

## Secure API key configuration

- **Never** put either API key in `frontend/config.js`, `frontend/script.js`, HTML, or any committed file.
- Add keys only in your backend host's Environment/Secrets settings. The included `.env.example` contains blank placeholders only.
- Do not share screenshots or logs containing keys. If a key was previously committed or pasted publicly, revoke it and create a replacement.
- GitHub Pages is a static frontend; it cannot keep API keys secret. All provider calls are made by `server.js`.
- The backend has CORS origin checks, request size limits, and per-IP rate limiting. CORS is not authentication; if this site will be used publicly, add user authentication or a challenge such as Cloudflare Turnstile and monitor provider usage to reduce abuse/costs.
- API use may incur charges and each provider has its own quotas and billing. The fallback cannot work until both keys are configured and the backend is deployed.

## Environment variables

See `.env.example`. For local development, copy it to `.env` (the `.env` file is ignored by Git), fill in the keys, and run `npm install` followed by `npm start`. Set `FRONTEND_ORIGIN` to the origin serving the frontend, such as `http://localhost:5500`.
