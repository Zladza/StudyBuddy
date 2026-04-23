# StudyBuddy — Design Spec
**Date:** 2026-04-23  
**Status:** Approved by product owner, ready for implementation planning  
**Scope:** MVP — auth wall, chat with AI, PDF upload, chat history, Serbian/English UI

---

## What we are building

StudyBuddy is a web app that lets university students in Serbia chat with an AI study assistant. Students log in, upload their lecture PDFs or skripte, and ask the assistant to explain things, summarize material, generate practice questions, or help structure a seminarski rad. The assistant always speaks Serbian by default and refuses to write finished exams or papers for the student.

---

## 1. How the app is structured (big picture)

Think of the app as three separate pieces that talk to each other:

```
[ Student's browser ]  →  [ Our server ]  →  [ Anthropic AI / Supabase ]
```

1. **Browser** — the pages the student sees and clicks. Built as simple HTML files with no heavy framework. Styled with Tailwind CSS (a popular style library loaded from the internet, no installation needed).

2. **Our server** — a Node.js program that sits between the browser and the AI. It holds the secret API key so it never leaks to students. It also checks that the student is logged in before allowing any AI call. Runs locally on your laptop during development; deployed to Vercel for the live site.

3. **Anthropic AI / Supabase** — external services we call from our server:
   - **Anthropic** provides the Claude AI model that generates responses.
   - **Supabase** provides user accounts (login/register) and a database to store chat history.

---

## 2. File and folder layout

```
StudyBuddy/
│
├── public/                   ← everything the browser loads
│   ├── index.html            ← the main chat page (only accessible after login)
│   ├── login.html            ← the register/login page
│   └── js/
│       ├── auth.js           ← handles login, logout, session check
│       ├── chat.js           ← handles sending messages, showing replies, loading history
│       └── i18n.js           ← all UI text in Serbian and English (the language toggle)
│
├── src/                      ← server-side logic (never sent to the browser)
│   ├── chat-handler.js       ← builds the AI request, streams the reply back
│   └── auth-middleware.js    ← checks that the user's login token is valid
│
├── api/                      ← thin wrappers used when deployed to Vercel
│   ├── chat.js               ← calls chat-handler.js
│   └── history.js            ← calls history logic
│
├── server.js                 ← local development server (run with: node server.js)
│
├── supabase/
│   └── schema.sql            ← the database table definitions
│
├── package.json              ← lists the Node.js packages we depend on
├── .env                      ← secret keys (never committed to git)
├── .env.example              ← shows which keys are needed, with empty values
└── .gitignore                ← tells git to ignore .env and other private files
```

**The key rule:** anything inside `src/` and the `.env` file never reaches the student's browser. The secret API keys live only there.

---

## 3. Pages

### 3a. Login page (`login.html`)

The first page every visitor sees. It has two tabs:
- **Registracija** — email + password + confirm password → creates an account; Supabase sends a confirmation email
- **Prijava** — email + password → logs in; on success, browser goes to the chat page

Brand: **StudyBuddy** (no "RS", just a BETA badge). Colors: navy `#1F4E79` as the primary button color.

### 3b. Chat page (`index.html`)

The main app. Split into two areas:

**Sidebar (left, navy background):**
- StudyBuddy logo + BETA badge
- "Novi razgovor" button — starts a fresh conversation
- **Istorija** section — list of past conversations, clickable to reload them. Only shown when at least one conversation exists. The most recent conversation is highlighted. Each item shows the auto-generated title.
- **Brze akcije** section with 5 buttons: Sumiraj / Objasni / Priprema za ispit / Seminarski / Reši zadatak — each inserts a pre-written template into the message box that the student can edit before sending. When the history list is long, only the top 2–3 quick actions remain visible; the rest scroll into view.
- Language toggle: SRP / ENG
- Disclaimer at the bottom: "Ne pišem gotove ispite ni seminarske radove."
- Collapses to a hamburger menu on mobile screens

**Main area (right, light background):**
- **Top bar** — conversation title on the left, user email + logout button on the right
- **Chat area** — messages displayed as speech bubbles; user messages on the right (navy), assistant replies on the left (white card). Replies render Markdown (bold, lists, code blocks, etc.)
- **Empty state** — when no conversation is active: greeting ("Zdravo!") using the part of the email before the @ sign (e.g. `ana` from `ana@etf.rs`) + 4 starter prompt cards: Objasni / Pitanja za ispit / Plan rada / Reši zadatak
- **Input bar at the bottom** — text area, paperclip button to attach a PDF, send button

---

## 4. How login and sessions work

1. The student fills in the login form.
2. The Supabase JS library (loaded in the browser) sends credentials to Supabase's servers.
3. Supabase returns a **JWT token** — think of it as a signed ticket that proves "this person is logged in."
4. The Supabase library stores this token automatically in the browser's localStorage (a small storage area in the browser).
5. When `index.html` loads, `auth.js` checks: "Is there a valid token in localStorage?" If not → redirect to `login.html` immediately. This is the **auth wall**.
6. The token expires after 1 hour, but the Supabase library renews it silently in the background — the student never gets logged out mid-session.
7. Every API call to our server includes this token in a header. The server checks it before doing anything.

---

## 5. How a chat message works (step by step)

This is what happens when a student types a question and hits Send:

1. `chat.js` collects the message text (and PDF if attached).
2. It sends a request to `POST /api/chat` on our server, including:
   - The conversation history so far (so the AI has context)
   - The new message
   - The language preference (sr or en)
   - The PDF as base64 text (a way to encode binary files as plain text), if attached
   - The login token in the request header
3. `auth-middleware.js` verifies the token with Supabase. If invalid → returns a 401 error immediately.
4. `chat-handler.js` validates the request (checks size, language value, etc.), then calls the Anthropic API with:
   - The system prompt (the instructions that make the AI behave like a study assistant)
   - The full conversation history
   - The PDF document (if present)
5. Anthropic streams the reply back **token by token** (like watching someone type in real time). Our server forwards each piece to the browser as a **Server-Sent Event (SSE)** — a standard web technique for pushing data to a browser without waiting for the full response.
6. `chat.js` in the browser listens for these events and appends each piece to the chat bubble as it arrives. The student sees words appearing in real time.
7. When the stream ends, `chat.js` saves the exchange to Supabase via `POST /api/history`.

**PDF handling:** The browser reads the PDF file and converts it to base64 text. This text is sent to the server, which forwards it directly to Claude using Anthropic's native PDF support. The PDF is never saved to disk on our server — it only passes through memory.

---

## 6. How chat history works

Every conversation is saved in the Supabase database under two tables:

**`conversations` table** — one row per conversation:
- A unique ID
- Which user it belongs to
- The title (auto-set to the first ~50 characters of the student's first message)
- Language preference
- When it was created and last updated

**`messages` table** — one row per message:
- Which conversation it belongs to
- Whether it's from the user or the assistant
- The text content
- Whether a PDF was attached
- When it was sent

**Privacy:** Row-Level Security (RLS) is enabled on both tables. This means Supabase automatically blocks any query that tries to read another user's conversations — even if someone found the database credentials. Each user can only ever see their own rows.

When the student opens a past conversation from the sidebar, `chat.js` fetches all messages for that conversation from `/api/history/:id` and renders them in the chat area.

---

## 7. The AI system prompt (what makes it "StudyBuddy")

The system prompt is a set of instructions sent to Claude with every conversation. It is defined in `chat-handler.js` and the student never sees it. Key rules it enforces:

- **Language:** reply in Serbian (Latin) by default; switch to English if the student writes in English; switch to Cyrillic if they write in Cyrillic
- **Tone:** informal "ti", friendly, like a helpful older colleague — never robotic or salesy
- **Allowed tasks:** explain concepts, summarize PDFs, create practice questions, help structure papers, walk through calculations
- **Forbidden:** write a finished exam answer, seminarski, or diplomski that the student will submit as their own — if asked, respond with a polite redirect: "Mogu da ti pomognem sa strukturom, argumentima i primerima, ali finalni tekst pišeš ti."
- **Terminology:** use authentic Serbian academic terms (ispit, kolokvijum, skripta, ESPB, rok, prijemni) — never awkwardly translate them
- **Honesty:** admit when uncertain, never fabricate references

---

## 8. Quick-action buttons — what they insert

When clicked, each button fills the message input with a template the student edits before sending:

| Button | Template inserted |
|---|---|
| Sumiraj | "Sumiraj mi ovaj materijal na jednoj strani." |
| Objasni | "Objasni mi ___ jednostavnim rečima." |
| Priprema za ispit | "Napravi mi 10 pitanja za vežbu iz ovog materijala, sa odgovorima." |
| Seminarski | "Pomozi mi da napravim plan i strukturu za seminarski rad na temu ___." |
| Reši zadatak | "Prođi korak po korak kroz ovaj zadatak i objasni svaki korak: ___." |

The four empty-state starter cards work the same way.

---

## 9. Error handling

The app handles errors gracefully — no raw technical messages ever shown to students:

| What went wrong | What the student sees (Serbian) |
|---|---|
| Not logged in | Redirect to login page |
| Network error | "Nema konekcije. Proveri internet vezu i pokušaj ponovo." |
| File too large (over 20 MB) | "Fajl je prevelik. Maksimalna veličina je 20 MB." |
| AI service error | "Nešto nije u redu sa asistentom. Pokušaj za koji trenutak." |
| Session expired | Redirect to login with message "Sesija je istekla. Prijavi se ponovo." |

---

## 10. Running locally vs. deploying to Vercel

**Local development (your laptop):**
1. Copy `.env.example` to `.env` and fill in your keys
2. Run `npm install` to download dependencies
3. Run `node server.js` — this starts Express, which serves the HTML files and handles API calls
4. Open `http://localhost:3000` in your browser

**Production (Vercel):**
1. Push code to GitHub
2. Connect the GitHub repo to Vercel
3. Add the same environment variables in Vercel's dashboard
4. Vercel automatically deploys on every push; `api/chat.js` and `api/history.js` become serverless functions

The core logic in `src/chat-handler.js` runs identically in both environments — the only difference is the wrapper (`server.js` locally, `api/*.js` on Vercel).

---

## 11. Security summary

| Concern | How it's handled |
|---|---|
| API key exposure | Key is in `.env` on the server only; never sent to the browser |
| Unauthorized API use | Every request requires a valid Supabase JWT; no token = no response |
| Oversized uploads | Server rejects requests over 30 MB before processing |
| Data isolation | Supabase RLS ensures users can only access their own data |
| HTTPS | Enforced by Vercel in production; HTTP only on localhost (safe for dev) |
| Error leaks | Generic messages to client; technical details stay in server logs |

---

## 12. What is NOT in this build (out of scope for MVP)

- Stripe payments / subscriptions
- Rate limiting (free vs paid tier)
- Google login
- Cyrillic script toggle
- Flashcard generator
- Mobile apps
- Any P1/P2 features from the PRD

These are designed to slot in later without restructuring what we build now.

---

## 13. Environment variables needed

Before the app can run, these values must be set in `.env` (local) and Vercel dashboard (production):

| Variable | What it is | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | The key that lets us call Claude | console.anthropic.com |
| `SUPABASE_URL` | The address of your Supabase project | Supabase dashboard → Settings → API |
| `SUPABASE_ANON_KEY` | Public key, safe for the browser | Supabase dashboard → Settings → API |
| `SUPABASE_SERVICE_KEY` | Admin key, server-only, never share | Supabase dashboard → Settings → API |

---

*Spec written: 2026-04-23. Ready for implementation planning.*
