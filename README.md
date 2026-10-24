# J.A.R.V.I.S Mobile Edition

A browser-based J.A.R.V.I.S assistant hosted with GitHub Pages.

## Setup

1. Open the website.
2. Enter your Google Gemini API key when prompted.
3. The key is saved in this browser's local storage for convenience.

## Important API key security note

This is a static GitHub Pages project. A Gemini key entered into browser JavaScript or local storage is not secret from the browser user and is not suitable for a public production service. Keep API usage restricted and monitored. For a more secure production deployment, route requests through a private backend and store the key in the backend host's environment variables.

The project uses Gemini only. It does not require an OpenAI API key or the additional Node.js backend files.
