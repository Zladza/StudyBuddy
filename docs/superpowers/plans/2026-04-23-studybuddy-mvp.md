# StudyBuddy MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully working StudyBuddy web app — auth-gated AI study assistant with streaming chat, PDF upload, persistent history, and Serbian/English UI.

**Architecture:** Express.js serves static files and API routes locally; the same core logic in `src/` is wrapped by thin Vercel serverless adapters in `api/` for production. Supabase handles email/password auth and Postgres storage. Anthropic Claude Sonnet 4.6 streams replies via Server-Sent Events.

**Tech Stack:** Node.js 18+, Express 4, `@anthropic-ai/sdk`, `@supabase/supabase-js`, `dotenv`, Jest + Supertest (tests), Tailwind CSS CDN, marked.js CDN, Inter font CDN

---

## File Map

Every file that will be created, and what it is responsible for:

```
StudyBuddy/
├── public/
│   ├── index.html              ← chat page shell: sidebar + main area + input bar
│   ├── login.html              ← register / login tabs
│   └── js/
│       ├── i18n.js             ← all UI strings in Serbian and English
│       ├── auth.js             ← Supabase client init, login/register/logout, session guard
│       └── chat.js             ← state, message rendering, SSE streaming, history loading
├── src/
│   ├── auth-middleware.js      ← verifies Supabase JWT on every API request
│   ├── history-handler.js      ← list/get/save conversations + messages via Supabase
│   └── chat-handler.js         ← builds system prompt, calls Anthropic, streams SSE back
├── api/
│   ├── config.js               ← returns public Supabase keys to the browser
│   ├── chat.js                 ← Vercel adapter → chat-handler.js
│   ├── history.js              ← Vercel adapter → history-handler (list + save)
│   └── history/
│       └── [id].js             ← Vercel adapter → history-handler (get single conversation)
├── tests/
│   ├── auth-middleware.test.js
│   ├── history-handler.test.js
│   ├── chat-handler.test.js
│   └── server.test.js
├── supabase/
│   └── schema.sql
├── server.js                   ← Express: static files + all API routes (local dev)
├── vercel.json
├── package.json
├── .env.example
└── .gitignore
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `supabase/schema.sql`
- Create directories: `public/js/`, `src/`, `api/history/`, `tests/`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "studybuddy",
  "version": "0.1.0",
  "description": "AI study assistant for Serbian university students",
  "scripts": {
    "start": "node server.js",
    "test": "jest --testPathPattern=tests/"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.40.0",
    "@supabase/supabase-js": "^2.39.0",
    "dotenv": "^16.4.5",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^6.3.4"
  },
  "jest": {
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
.env
.vercel/
.superpowers/
```

- [ ] **Step 3: Create .env.example**

```
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
PORT=3000
```

- [ ] **Step 4: Create supabase/schema.sql**

```sql
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run

create table conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  title       text not null default 'Novi razgovor',
  language    text not null default 'sr' check (language in ('sr', 'en')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references conversations(id) on delete cascade not null,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  has_pdf          boolean default false,
  created_at       timestamptz default now()
);

alter table conversations enable row level security;
alter table messages enable row level security;

create policy "users see own conversations"
  on conversations for all
  using (auth.uid() = user_id);

create policy "users see own messages"
  on messages for all
  using (
    conversation_id in (
      select id from conversations where user_id = auth.uid()
    )
  );
```

- [ ] **Step 5: Create directories and install dependencies**

```bash
mkdir -p public/js src api/history tests supabase
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore .env.example supabase/schema.sql
git commit -m "feat: project scaffold"
```

---

## Task 2: Express server with static file serving

**Files:**
- Create: `server.js`
- Create: `tests/server.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/server.test.js`:

```javascript
const request = require('supertest')

// Load env before requiring server
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_KEY = 'test-service-key'
process.env.SUPABASE_ANON_KEY = 'test-anon-key'
process.env.ANTHROPIC_API_KEY = 'test-api-key'

const app = require('../server')

test('GET /api/health returns 200 with status ok', async () => {
  const res = await request(app).get('/api/health')
  expect(res.status).toBe(200)
  expect(res.body).toEqual({ status: 'ok' })
})

test('GET /api/config returns supabaseUrl and supabaseAnonKey', async () => {
  const res = await request(app).get('/api/config')
  expect(res.status).toBe(200)
  expect(res.body.supabaseUrl).toBe('https://test.supabase.co')
  expect(res.body.supabaseAnonKey).toBe('test-anon-key')
})

test('GET /nonexistent returns 404', async () => {
  const res = await request(app).get('/nonexistent-route-xyz')
  expect(res.status).toBe(404)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=tests/server.test.js
```

Expected: FAIL — `Cannot find module '../server'`

- [ ] **Step 3: Create server.js**

```javascript
require('dotenv').config()
const express = require('express')
const path = require('path')

const app = express()

app.use(express.json({ limit: '30mb' }))
app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  })
})

// Auth, history, and chat routes are mounted in later tasks.
// 404 fallback for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

if (require.main === module) {
  const port = process.env.PORT || 3000
  app.listen(port, () => console.log(`StudyBuddy running at http://localhost:${port}`))
}

module.exports = app
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=tests/server.test.js
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server.js tests/server.test.js
git commit -m "feat: express server with health and config endpoints"
```

---

## Task 3: i18n string module

**Files:**
- Create: `public/js/i18n.js`
- Create: `tests/i18n.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/i18n.test.js`:

```javascript
const I18N = require('../public/js/i18n.js')

test('Serbian strings are defined', () => {
  expect(I18N.sr.newChat).toBe('Novi razgovor')
  expect(I18N.sr.disclaimer).toBe('Ne pišem gotove ispite ni seminarske radove.')
  expect(I18N.sr.networkError).toBe('Nema konekcije. Proveri internet vezu i pokušaj ponovo.')
  expect(I18N.sr.tplExplain).toBe('Objasni mi ___ jednostavnim rečima.')
})

test('English strings are defined', () => {
  expect(I18N.en.newChat).toBe('New conversation')
  expect(I18N.en.disclaimer).toBe("I don't write finished exams or essays.")
  expect(I18N.en.tplExplain).toBe('Explain ___ in simple terms.')
})

test('Both languages have the same keys', () => {
  const srKeys = Object.keys(I18N.sr).sort()
  const enKeys = Object.keys(I18N.en).sort()
  expect(srKeys).toEqual(enKeys)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=tests/i18n.test.js
```

Expected: FAIL — `Cannot find module '../public/js/i18n.js'`

- [ ] **Step 3: Create public/js/i18n.js**

```javascript
const I18N = {
  sr: {
    newChat: 'Novi razgovor',
    quickActions: 'Brze akcije',
    history: 'Istorija',
    summarize: 'Sumiraj',
    explain: 'Objasni',
    examPrep: 'Priprema za ispit',
    essay: 'Seminarski',
    solve: 'Reši zadatak',
    disclaimer: 'Ne pišem gotove ispite ni seminarske radove.',
    greeting: 'Zdravo',
    greetingSubtitle: 'Tvoj stariji kolega za učenje. Postavi pitanje ili odaberi početak:',
    inputPlaceholder: 'Postavi pitanje ili priloži PDF...',
    continueConversation: 'Nastavi razgovor...',
    logout: 'Odjava',
    loginTab: 'Prijava',
    registerTab: 'Registracija',
    emailLabel: 'Email',
    passwordLabel: 'Lozinka',
    confirmPasswordLabel: 'Potvrdi lozinku',
    loginButton: 'Prijavi se',
    registerButton: 'Registruj se',
    confirmEmailMsg: 'Potvrdi svoju email adresu pa se prijavi.',
    passwordMismatch: 'Lozinke se ne poklapaju.',
    networkError: 'Nema konekcije. Proveri internet vezu i pokušaj ponovo.',
    fileTooLarge: 'Fajl je prevelik. Maksimalna veličina je 20 MB.',
    aiError: 'Nešto nije u redu sa asistentom. Pokušaj za koji trenutak.',
    sessionExpired: 'Sesija je istekla. Prijavi se ponovo.',
    authError: 'Pogrešan email ili lozinka.',
    starterExplain: 'Objasni mi pojam iz predavanja',
    starterExamQuestions: 'Napravi 10 pitanja za vežbu iz ove skripte',
    starterEssay: 'Pomozi mi da strukturišem seminarski',
    starterSolve: 'Prođi korak po korak kroz ovaj zadatak',
    tplSummarize: 'Sumiraj mi ovaj materijal na jednoj strani.',
    tplExplain: 'Objasni mi ___ jednostavnim rečima.',
    tplExamPrep: 'Napravi mi 10 pitanja za vežbu iz ovog materijala, sa odgovorima.',
    tplEssay: 'Pomozi mi da napravim plan i strukturu za seminarski rad na temu ___.',
    tplSolve: 'Prođi korak po korak kroz ovaj zadatak i objasni svaki korak: ___.',
    pdfAttached: 'PDF priložen',
    removePdf: 'Ukloni',
    sending: 'Šalje se...',
    noConversations: 'Još nema razgovora.',
  },
  en: {
    newChat: 'New conversation',
    quickActions: 'Quick actions',
    history: 'History',
    summarize: 'Summarize',
    explain: 'Explain',
    examPrep: 'Exam prep',
    essay: 'Essay',
    solve: 'Solve problem',
    disclaimer: "I don't write finished exams or essays.",
    greeting: 'Hello',
    greetingSubtitle: 'Your AI study buddy. Ask a question or choose a starting point:',
    inputPlaceholder: 'Ask a question or attach a PDF...',
    continueConversation: 'Continue the conversation...',
    logout: 'Log out',
    loginTab: 'Log in',
    registerTab: 'Register',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    confirmPasswordLabel: 'Confirm password',
    loginButton: 'Log in',
    registerButton: 'Register',
    confirmEmailMsg: 'Check your email and confirm your address, then log in.',
    passwordMismatch: 'Passwords do not match.',
    networkError: 'No connection. Check your internet and try again.',
    fileTooLarge: 'File too large. Maximum size is 20 MB.',
    aiError: 'Something went wrong with the assistant. Try again in a moment.',
    sessionExpired: 'Session expired. Please log in again.',
    authError: 'Incorrect email or password.',
    starterExplain: 'Explain a concept from my lecture',
    starterExamQuestions: 'Generate 10 practice questions from my notes',
    starterEssay: 'Help me structure my essay',
    starterSolve: 'Walk me through this problem step by step',
    tplSummarize: 'Summarize this material in one page.',
    tplExplain: 'Explain ___ in simple terms.',
    tplExamPrep: 'Create 10 practice questions from this material, with answers.',
    tplEssay: 'Help me create a plan and structure for an essay on the topic of ___.',
    tplSolve: 'Walk through this problem step by step and explain each step: ___.',
    pdfAttached: 'PDF attached',
    removePdf: 'Remove',
    sending: 'Sending...',
    noConversations: 'No conversations yet.',
  }
}

// Works in both browser (global) and Node.js (require)
if (typeof module !== 'undefined') module.exports = I18N
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=tests/i18n.test.js
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add public/js/i18n.js tests/i18n.test.js
git commit -m "feat: i18n strings for Serbian and English"
```

---

## Task 4: Auth middleware

**Files:**
- Create: `src/auth-middleware.js`
- Create: `tests/auth-middleware.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/auth-middleware.test.js`:

```javascript
const { makeAuthMiddleware } = require('../src/auth-middleware')

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

test('returns 401 when Authorization header is missing', async () => {
  const middleware = makeAuthMiddleware({ auth: { getUser: jest.fn() } })
  const req = { headers: {} }
  const res = mockRes()
  const next = jest.fn()

  await middleware(req, res, next)

  expect(res.status).toHaveBeenCalledWith(401)
  expect(next).not.toHaveBeenCalled()
})

test('returns 401 when token is invalid', async () => {
  const fakeClient = {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: new Error('invalid') })
    }
  }
  const middleware = makeAuthMiddleware(fakeClient)
  const req = { headers: { authorization: 'Bearer bad-token' } }
  const res = mockRes()
  const next = jest.fn()

  await middleware(req, res, next)

  expect(res.status).toHaveBeenCalledWith(401)
  expect(next).not.toHaveBeenCalled()
})

test('calls next() and sets req.user when token is valid', async () => {
  const fakeUser = { id: 'user-123', email: 'ana@etf.rs' }
  const fakeClient = {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: fakeUser }, error: null })
    }
  }
  const middleware = makeAuthMiddleware(fakeClient)
  const req = { headers: { authorization: 'Bearer valid-token' } }
  const res = mockRes()
  const next = jest.fn()

  await middleware(req, res, next)

  expect(next).toHaveBeenCalled()
  expect(req.user).toEqual(fakeUser)
  expect(req.token).toBe('valid-token')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=tests/auth-middleware.test.js
```

Expected: FAIL — `Cannot find module '../src/auth-middleware'`

- [ ] **Step 3: Create src/auth-middleware.js**

```javascript
const { createClient } = require('@supabase/supabase-js')

function makeAuthMiddleware(supabaseClient) {
  const client = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  return async (req, res, next) => {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const token = auth.slice(7)
    const { data, error } = await client.auth.getUser(token)
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    req.user = data.user
    req.token = token
    next()
  }
}

module.exports = { makeAuthMiddleware }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=tests/auth-middleware.test.js
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/auth-middleware.js tests/auth-middleware.test.js
git commit -m "feat: JWT auth middleware with Supabase verification"
```

---

## Task 5: History handler

**Files:**
- Create: `src/history-handler.js`
- Create: `tests/history-handler.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/history-handler.test.js`:

```javascript
const { makeHistoryHandler } = require('../src/history-handler')

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

function makeChain(result) {
  const chain = {}
  const methods = ['from', 'select', 'eq', 'order', 'insert', 'update', 'single']
  methods.forEach(m => { chain[m] = jest.fn().mockReturnValue(chain) })
  chain.single = jest.fn().mockResolvedValue(result)
  // Make the last method in a chain resolve
  chain.order = jest.fn().mockResolvedValue(result)
  chain.eq = jest.fn().mockReturnValue(chain)
  return chain
}

test('listConversations returns conversations array', async () => {
  const fakeConvs = [{ id: 'c1', title: 'Test', language: 'sr', updated_at: '2026-01-01' }]
  const chain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: fakeConvs, error: null })
  }
  const fakeClient = chain
  const handler = makeHistoryHandler(fakeClient)

  const req = { user: { id: 'user-123' } }
  const res = mockRes()

  await handler.listConversations(req, res)

  expect(res.json).toHaveBeenCalledWith(fakeConvs)
})

test('listConversations returns 500 on database error', async () => {
  const chain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: null, error: new Error('db error') })
  }
  const handler = makeHistoryHandler(chain)
  const req = { user: { id: 'user-123' } }
  const res = mockRes()

  await handler.listConversations(req, res)

  expect(res.status).toHaveBeenCalledWith(500)
})

test('saveExchange creates new conversation and saves messages', async () => {
  const insertSpy = jest.fn()
    .mockReturnValueOnce({ select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: 'new-conv-id' }, error: null }) })
    .mockReturnValueOnce({ then: jest.fn(), ...Promise.resolve({ data: null, error: null }) })

  let insertCallCount = 0
  const fakeClient = {
    from: jest.fn().mockReturnThis(),
    insert: jest.fn().mockImplementation(() => {
      insertCallCount++
      if (insertCallCount === 1) {
        return { select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: 'new-conv-id' }, error: null }) }
      }
      return Promise.resolve({ data: null, error: null })
    }),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
  }

  const handler = makeHistoryHandler(fakeClient)
  const req = {
    user: { id: 'user-123' },
    body: {
      language: 'sr',
      messages: [
        { role: 'user', content: 'Objasni mi Thevenina', has_pdf: false },
        { role: 'assistant', content: 'Theveninova teorema...', has_pdf: false }
      ]
    }
  }
  const res = mockRes()

  await handler.saveExchange(req, res)

  expect(res.json).toHaveBeenCalledWith({ conversationId: 'new-conv-id' })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=tests/history-handler.test.js
```

Expected: FAIL — `Cannot find module '../src/history-handler'`

- [ ] **Step 3: Create src/history-handler.js**

```javascript
const { createClient } = require('@supabase/supabase-js')

function makeHistoryHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  async function listConversations(req, res) {
    const { data, error } = await db
      .from('conversations')
      .select('id, title, language, updated_at')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('listConversations error:', error)
      return res.status(500).json({ error: 'Greška pri učitavanju istorije.' })
    }
    res.json(data)
  }

  async function getConversation(req, res) {
    const { id } = req.params

    const { data: conv, error: convError } = await db
      .from('conversations')
      .select('id, title, language')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single()

    if (convError || !conv) {
      return res.status(404).json({ error: 'Razgovor nije pronađen.' })
    }

    const { data: messages, error } = await db
      .from('messages')
      .select('id, role, content, has_pdf, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('getConversation messages error:', error)
      return res.status(500).json({ error: 'Greška pri učitavanju poruka.' })
    }
    res.json({ conversation: conv, messages })
  }

  async function saveExchange(req, res) {
    const { conversationId, language, messages } = req.body

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages must be a non-empty array.' })
    }

    let convId = conversationId

    if (!convId) {
      const autoTitle = messages[0]?.content?.slice(0, 50) || 'Novi razgovor'
      const { data, error } = await db
        .from('conversations')
        .insert({ user_id: req.user.id, title: autoTitle, language: language || 'sr' })
        .select('id')
        .single()

      if (error) {
        console.error('saveExchange create conv error:', error)
        return res.status(500).json({ error: 'Greška pri čuvanju razgovora.' })
      }
      convId = data.id
    } else {
      await db
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', convId)
        .eq('user_id', req.user.id)
    }

    const rows = messages.map(m => ({
      conversation_id: convId,
      role: m.role,
      content: m.content,
      has_pdf: m.has_pdf || false
    }))

    const { error: msgError } = await db.from('messages').insert(rows)
    if (msgError) {
      console.error('saveExchange insert messages error:', msgError)
      return res.status(500).json({ error: 'Greška pri čuvanju poruka.' })
    }

    res.json({ conversationId: convId })
  }

  return { listConversations, getConversation, saveExchange }
}

module.exports = { makeHistoryHandler }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=tests/history-handler.test.js
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/history-handler.js tests/history-handler.test.js
git commit -m "feat: history handler — list, get, and save conversations"
```

---

## Task 6: Mount history routes in server.js

**Files:**
- Modify: `server.js` (add history routes)
- Create: `api/history.js`
- Create: `api/history/[id].js`

- [ ] **Step 1: Write the failing test**

Add to `tests/server.test.js` (append below the existing tests):

```javascript
test('GET /api/history returns 401 without token', async () => {
  const res = await request(app).get('/api/history')
  expect(res.status).toBe(401)
})

test('POST /api/history returns 401 without token', async () => {
  const res = await request(app).post('/api/history').send({})
  expect(res.status).toBe(401)
})

test('GET /api/history/some-id returns 401 without token', async () => {
  const res = await request(app).get('/api/history/some-id')
  expect(res.status).toBe(401)
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
npm test -- --testPathPattern=tests/server.test.js
```

Expected: 3 existing tests PASS, 3 new tests FAIL with 404 (routes not mounted yet)

- [ ] **Step 3: Mount history routes in server.js**

Replace the comment `// Auth, history, and chat routes are mounted in later tasks.` in `server.js` with:

```javascript
const { makeAuthMiddleware } = require('./src/auth-middleware')
const { makeHistoryHandler } = require('./src/history-handler')

const requireAuth = makeAuthMiddleware()
const history = makeHistoryHandler()

app.get('/api/history', requireAuth, (req, res) => history.listConversations(req, res))
app.post('/api/history', requireAuth, (req, res) => history.saveExchange(req, res))
app.get('/api/history/:id', requireAuth, (req, res) => history.getConversation(req, res))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=tests/server.test.js
```

Expected: PASS (6 tests) — the new 401 tests pass because routes now exist and reject missing tokens.

- [ ] **Step 5: Create Vercel adapter api/history.js**

```javascript
const { makeAuthMiddleware } = require('../src/auth-middleware')
const { makeHistoryHandler } = require('../src/history-handler')

const requireAuth = makeAuthMiddleware()
const history = makeHistoryHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try {
    await applyMiddleware(requireAuth, req, res)
  } catch {
    return
  }
  if (req.method === 'GET') return history.listConversations(req, res)
  if (req.method === 'POST') return history.saveExchange(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
```

- [ ] **Step 6: Create Vercel adapter api/history/[id].js**

```javascript
const { makeAuthMiddleware } = require('../../src/auth-middleware')
const { makeHistoryHandler } = require('../../src/history-handler')

const requireAuth = makeAuthMiddleware()
const history = makeHistoryHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try {
    await applyMiddleware(requireAuth, req, res)
  } catch {
    return
  }
  if (req.method === 'GET') {
    req.params = { id: req.query.id }
    return history.getConversation(req, res)
  }
  res.status(405).json({ error: 'Method not allowed' })
}
```

- [ ] **Step 7: Commit**

```bash
git add server.js api/history.js "api/history/[id].js"
git commit -m "feat: history API routes with auth guard"
```

---

## Task 7: Chat handler

**Files:**
- Create: `src/chat-handler.js`
- Create: `tests/chat-handler.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/chat-handler.test.js`:

```javascript
const { validateRequest, buildMessages, SYSTEM_PROMPT } = require('../src/chat-handler')

test('validateRequest returns error for missing messages', () => {
  expect(validateRequest({ language: 'sr' })).toBe('Messages must be an array.')
})

test('validateRequest returns error for invalid language', () => {
  expect(validateRequest({ messages: [], language: 'de' })).toBe('Language must be sr or en.')
})

test('validateRequest returns null for valid input', () => {
  expect(validateRequest({ messages: [], language: 'sr' })).toBeNull()
  expect(validateRequest({ messages: [], language: 'en' })).toBeNull()
})

test('buildMessages converts plain messages to Anthropic format', () => {
  const input = [
    { role: 'user', content: 'Objasni mi Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ]
  const result = buildMessages(input, null)
  expect(result).toEqual([
    { role: 'user', content: 'Objasni mi Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ])
})

test('buildMessages wraps last user message with PDF document block', () => {
  const input = [
    { role: 'user', content: 'Sumiraj ovo' }
  ]
  const result = buildMessages(input, 'base64pdfdata==')
  expect(result[0].content).toEqual([
    {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'base64pdfdata==' }
    },
    { type: 'text', text: 'Sumiraj ovo' }
  ])
})

test('SYSTEM_PROMPT contains key StudyBuddy instructions', () => {
  expect(SYSTEM_PROMPT).toContain('StudyBuddy')
  expect(SYSTEM_PROMPT).toContain('seminarski')
  expect(SYSTEM_PROMPT).toContain('finalni tekst pišeš ti')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=tests/chat-handler.test.js
```

Expected: FAIL — `Cannot find module '../src/chat-handler'`

- [ ] **Step 3: Create src/chat-handler.js**

```javascript
const Anthropic = require('@anthropic-ai/sdk')

const SYSTEM_PROMPT = `You are StudyBuddy, an AI academic assistant built specifically for university students in Serbia (primarily Belgrade).

LANGUAGE
- Default reply language: Serbian in Latin script.
- If the student writes in English, reply in English.
- If the student writes in Cyrillic, reply in Cyrillic.
- Use informal "ti", friendly but professional — like a helpful older colleague (stariji kolega).
- Use authentic Serbian academic terminology: ispit, kolokvijum, seminarski rad, skripta, ispitni rok, ESPB, prijemni, apsolvent.

WHAT YOU HELP WITH
1. Explain lectures, concepts, and theories in plain language.
2. Summarize PDFs, skripte, and books (ask whether the student wants 1-page, chapter-by-chapter, or detailed).
3. Create exam prep: short notes, key formulas, 10 practice questions with step-by-step answers.
4. Help with seminarski and diplomski radovi: outline, structure, citations (APA / MLA / Harvard), grammar review.
5. Walk through calculations step by step.
6. Answer course-specific questions when the student has uploaded their own materials.

ACADEMIC INTEGRITY
- Never write a finished exam answer, seminarski, or diplomski that the student will submit as their own.
- Always explain, outline, suggest structure, and give examples — but the student writes the final work.
- If asked to write a finished essay or exam answer, respond: "Mogu da ti pomognem sa strukturom, argumentima i primerima, ali finalni tekst pišeš ti — to je deo učenja. Hoćemo da počnemo od plana rada?"

TONE & FORMAT
- Short paragraphs. Bullet lists for steps. Use Markdown.
- Use examples from Balkan context where relevant.
- Admit when you don't know something.
- Never fabricate references or citations.

SAFETY
- No medical, legal, or financial advice beyond academic explanation.
- If a student seems in distress, briefly acknowledge and gently point them to Studentski psihološki savetnik or a trusted adult.`

function validateRequest(body) {
  if (!body.messages || !Array.isArray(body.messages)) return 'Messages must be an array.'
  if (!['sr', 'en'].includes(body.language)) return 'Language must be sr or en.'
  return null
}

function buildMessages(messages, pdfBase64) {
  if (!pdfBase64) return messages

  // Find the last user message and attach the PDF to it
  const result = messages.map((m, i) => {
    const isLastUser = m.role === 'user' && !messages.slice(i + 1).some(x => x.role === 'user')
    if (!isLastUser) return m
    return {
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: m.content }
      ]
    }
  })

  return result
}

async function handleChat(req, res, anthropicClient) {
  const validationError = validateRequest(req.body)
  if (validationError) {
    return res.status(400).json({ error: validationError })
  }

  const { messages, language, pdf } = req.body
  const client = anthropicClient || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const anthropicMessages = buildMessages(messages, pdf || null)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: anthropicMessages
    })

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`)
    })

    await stream.finalMessage()
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  } catch (err) {
    console.error('handleChat error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'AI service error.' })
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Nešto nije u redu sa asistentom. Pokušaj za koji trenutak.' })}\n\n`)
      res.end()
    }
  }
}

module.exports = { handleChat, validateRequest, buildMessages, SYSTEM_PROMPT }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=tests/chat-handler.test.js
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/chat-handler.js tests/chat-handler.test.js
git commit -m "feat: chat handler with system prompt, validation, and streaming"
```

---

## Task 8: Mount chat route and Vercel adapter

**Files:**
- Modify: `server.js` (add `/api/chat` route)
- Create: `api/chat.js`
- Create: `api/config.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/server.test.js`:

```javascript
test('POST /api/chat returns 401 without token', async () => {
  const res = await request(app)
    .post('/api/chat')
    .send({ messages: [], language: 'sr' })
  expect(res.status).toBe(401)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=tests/server.test.js
```

Expected: the new test FAILS with 404.

- [ ] **Step 3: Add chat route to server.js**

Add this block to `server.js` after the history routes:

```javascript
const { handleChat } = require('./src/chat-handler')

app.post('/api/chat', requireAuth, (req, res) => handleChat(req, res))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=tests/server.test.js
```

Expected: PASS (7 tests)

- [ ] **Step 5: Create Vercel adapter api/chat.js**

```javascript
const { makeAuthMiddleware } = require('../src/auth-middleware')
const { handleChat } = require('../src/chat-handler')

const requireAuth = makeAuthMiddleware()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    await applyMiddleware(requireAuth, req, res)
  } catch {
    return
  }
  return handleChat(req, res)
}
```

- [ ] **Step 6: Create Vercel adapter api/config.js**

```javascript
module.exports = (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  })
}
```

- [ ] **Step 7: Commit**

```bash
git add server.js api/chat.js api/config.js
git commit -m "feat: chat and config API routes with Vercel adapters"
```

---

## Task 9: Login page

**Files:**
- Create: `public/login.html`
- Create: `public/js/auth.js`

This task is verified manually — open the browser and test the flows.

- [ ] **Step 1: Create public/js/auth.js**

```javascript
/* global supabase, I18N */

let sb = null
let currentLang = navigator.language.startsWith('sr') ? 'sr' : 'en'

async function initAuth() {
  const config = await fetch('/api/config').then(r => r.json())
  sb = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  return sb
}

async function getSession() {
  if (!sb) await initAuth()
  const { data } = await sb.auth.getSession()
  return data.session
}

async function requireSession() {
  const session = await getSession()
  if (!session) {
    window.location.href = '/login.html'
    return null
  }
  return session
}

async function signIn(email, password) {
  if (!sb) await initAuth()
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  return { data, error }
}

async function signUp(email, password) {
  if (!sb) await initAuth()
  const { data, error } = await sb.auth.signUp({ email, password })
  return { data, error }
}

async function signOut() {
  if (!sb) await initAuth()
  await sb.auth.signOut()
  window.location.href = '/login.html'
}

function getAccessToken() {
  const key = Object.keys(localStorage).find(k => k.endsWith('-auth-token'))
  if (!key) return null
  try {
    return JSON.parse(localStorage.getItem(key))?.access_token || null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Create public/login.html**

```html
<!DOCTYPE html>
<html lang="sr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StudyBuddy — Prijava</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style> body { font-family: 'Inter', sans-serif; } </style>
</head>
<body class="min-h-screen bg-slate-50 flex items-center justify-center p-4">

  <div class="w-full max-w-sm">
    <!-- Brand -->
    <div class="text-center mb-8">
      <div class="inline-flex items-center gap-2 mb-2">
        <div class="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center text-white text-lg">📚</div>
        <span class="text-xl font-semibold text-slate-800">StudyBuddy</span>
        <span class="text-xs font-semibold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">BETA</span>
      </div>
    </div>

    <!-- Card -->
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <!-- Tabs -->
      <div class="flex mb-6 bg-slate-100 rounded-lg p-1">
        <button id="tab-login" onclick="showTab('login')"
          class="flex-1 py-1.5 text-sm font-medium rounded-md bg-white shadow-sm text-slate-800 transition">
          Prijava
        </button>
        <button id="tab-register" onclick="showTab('register')"
          class="flex-1 py-1.5 text-sm font-medium rounded-md text-slate-500 transition">
          Registracija
        </button>
      </div>

      <!-- Login form -->
      <form id="form-login" onsubmit="handleLogin(event)" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input id="login-email" type="email" required
            class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1F4E79] focus:ring-2 focus:ring-[#1F4E79]/10"
            placeholder="ana@etf.rs">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Lozinka</label>
          <input id="login-password" type="password" required
            class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1F4E79] focus:ring-2 focus:ring-[#1F4E79]/10">
        </div>
        <p id="login-error" class="text-red-500 text-sm hidden"></p>
        <button type="submit" id="login-btn"
          class="w-full bg-[#1F4E79] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#1a4268] transition">
          Prijavi se
        </button>
      </form>

      <!-- Register form -->
      <form id="form-register" onsubmit="handleRegister(event)" class="space-y-4 hidden">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input id="reg-email" type="email" required
            class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1F4E79] focus:ring-2 focus:ring-[#1F4E79]/10"
            placeholder="ana@etf.rs">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Lozinka</label>
          <input id="reg-password" type="password" required minlength="8"
            class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1F4E79] focus:ring-2 focus:ring-[#1F4E79]/10">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Potvrdi lozinku</label>
          <input id="reg-confirm" type="password" required
            class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#1F4E79] focus:ring-2 focus:ring-[#1F4E79]/10">
        </div>
        <p id="reg-error" class="text-red-500 text-sm hidden"></p>
        <p id="reg-success" class="text-green-600 text-sm hidden"></p>
        <button type="submit" id="register-btn"
          class="w-full bg-[#1F4E79] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#1a4268] transition">
          Registruj se
        </button>
      </form>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="/js/i18n.js"></script>
  <script src="/js/auth.js"></script>
  <script>
    // Redirect to chat if already logged in
    (async () => {
      const session = await getSession()
      if (session) window.location.href = '/'
    })()

    function showTab(tab) {
      const isLogin = tab === 'login'
      document.getElementById('form-login').classList.toggle('hidden', !isLogin)
      document.getElementById('form-register').classList.toggle('hidden', isLogin)
      document.getElementById('tab-login').className = isLogin
        ? 'flex-1 py-1.5 text-sm font-medium rounded-md bg-white shadow-sm text-slate-800 transition'
        : 'flex-1 py-1.5 text-sm font-medium rounded-md text-slate-500 transition'
      document.getElementById('tab-register').className = isLogin
        ? 'flex-1 py-1.5 text-sm font-medium rounded-md text-slate-500 transition'
        : 'flex-1 py-1.5 text-sm font-medium rounded-md bg-white shadow-sm text-slate-800 transition'
    }

    async function handleLogin(e) {
      e.preventDefault()
      const btn = document.getElementById('login-btn')
      const errEl = document.getElementById('login-error')
      btn.disabled = true
      btn.textContent = 'Prijavljujem...'
      errEl.classList.add('hidden')

      const { error } = await signIn(
        document.getElementById('login-email').value,
        document.getElementById('login-password').value
      )

      if (error) {
        errEl.textContent = I18N.sr.authError
        errEl.classList.remove('hidden')
        btn.disabled = false
        btn.textContent = 'Prijavi se'
      } else {
        window.location.href = '/'
      }
    }

    async function handleRegister(e) {
      e.preventDefault()
      const btn = document.getElementById('register-btn')
      const errEl = document.getElementById('reg-error')
      const successEl = document.getElementById('reg-success')
      const password = document.getElementById('reg-password').value
      const confirm = document.getElementById('reg-confirm').value

      errEl.classList.add('hidden')
      successEl.classList.add('hidden')

      if (password !== confirm) {
        errEl.textContent = I18N.sr.passwordMismatch
        errEl.classList.remove('hidden')
        return
      }

      btn.disabled = true
      btn.textContent = 'Registrujem...'

      const { error } = await signUp(
        document.getElementById('reg-email').value,
        password
      )

      if (error) {
        errEl.textContent = error.message
        errEl.classList.remove('hidden')
        btn.disabled = false
        btn.textContent = 'Registruj se'
      } else {
        successEl.textContent = I18N.sr.confirmEmailMsg
        successEl.classList.remove('hidden')
        btn.disabled = false
        btn.textContent = 'Registruj se'
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 3: Manually test login page**

```bash
node server.js
```

Open `http://localhost:3000/login.html` and verify:
- Page loads with StudyBuddy brand and BETA badge
- Login and Registracija tabs switch correctly
- Register with a real email → success message appears
- Confirm the email in your inbox
- Log in → redirected to `http://localhost:3000/`  (shows 404 for now — chat page not built yet)
- If already logged in and you visit `/login.html`, you are redirected to `/`

- [ ] **Step 4: Commit**

```bash
git add public/login.html public/js/auth.js
git commit -m "feat: login and register page with Supabase auth"
```

---

## Task 10: Chat page HTML structure

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Create public/index.html**

```html
<!DOCTYPE html>
<html lang="sr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StudyBuddy</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    body { font-family: 'Inter', sans-serif; }
    #chat-messages { scroll-behavior: smooth; }
    .msg-bubble { line-height: 1.65; }
    .msg-bubble p { margin-bottom: 0.5rem; }
    .msg-bubble p:last-child { margin-bottom: 0; }
    .msg-bubble ul, .msg-bubble ol { padding-left: 1.25rem; margin-bottom: 0.5rem; }
    .msg-bubble code { background: rgba(0,0,0,0.06); padding: 0.1em 0.3em; border-radius: 4px; font-size: 0.875em; }
    .msg-bubble pre { background: rgba(0,0,0,0.06); padding: 0.75rem; border-radius: 8px; overflow-x: auto; margin-bottom: 0.5rem; }
    .msg-bubble pre code { background: none; padding: 0; }
    /* Sidebar transition */
    #sidebar { transition: transform 0.2s ease; }
    @media (max-width: 640px) {
      #sidebar.hidden-mobile { transform: translateX(-100%); }
    }
  </style>
</head>
<body class="h-screen flex overflow-hidden bg-slate-50">

  <!-- Mobile overlay -->
  <div id="mobile-overlay" onclick="closeSidebar()"
    class="fixed inset-0 bg-black/40 z-20 hidden sm:hidden"></div>

  <!-- Sidebar -->
  <aside id="sidebar"
    class="fixed sm:relative z-30 sm:z-auto w-56 h-full bg-[#1F4E79] flex flex-col py-5 px-3.5 gap-2 shrink-0 -translate-x-full sm:translate-x-0">

    <!-- Brand -->
    <div class="flex items-center gap-2 px-1 mb-2">
      <div class="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center text-sm shrink-0">📚</div>
      <span class="text-white font-semibold text-sm">StudyBuddy</span>
      <span class="text-blue-300 text-[10px] font-semibold tracking-wide">BETA</span>
    </div>

    <!-- New chat -->
    <button onclick="startNewChat()"
      class="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg px-3 py-2 text-white text-sm font-medium transition">
      ＋ <span id="btn-new-chat">Novi razgovor</span>
    </button>

    <!-- History -->
    <div id="history-section" class="hidden">
      <p id="lbl-history" class="text-blue-300 text-[10px] font-semibold uppercase tracking-widest px-1 pt-2 pb-1">Istorija</p>
      <div id="history-list" class="flex flex-col gap-0.5 max-h-40 overflow-y-auto"></div>
    </div>

    <!-- Quick actions -->
    <p id="lbl-quick-actions" class="text-blue-300 text-[10px] font-semibold uppercase tracking-widest px-1 pt-2 pb-1">Brze akcije</p>
    <div id="quick-actions" class="flex flex-col gap-0.5">
      <button onclick="insertTemplate('tplSummarize')" class="quick-action-btn flex items-center gap-2 px-2 py-1.5 rounded-lg text-white/85 hover:bg-white/10 text-sm text-left transition">📄 <span data-i18n="summarize">Sumiraj</span></button>
      <button onclick="insertTemplate('tplExplain')" class="quick-action-btn flex items-center gap-2 px-2 py-1.5 rounded-lg text-white/85 hover:bg-white/10 text-sm text-left transition">💡 <span data-i18n="explain">Objasni</span></button>
      <button onclick="insertTemplate('tplExamPrep')" class="quick-action-btn flex items-center gap-2 px-2 py-1.5 rounded-lg text-white/85 hover:bg-white/10 text-sm text-left transition">📝 <span data-i18n="examPrep">Priprema za ispit</span></button>
      <button onclick="insertTemplate('tplEssay')" class="quick-action-btn flex items-center gap-2 px-2 py-1.5 rounded-lg text-white/85 hover:bg-white/10 text-sm text-left transition">✍️ <span data-i18n="essay">Seminarski</span></button>
      <button onclick="insertTemplate('tplSolve')" class="quick-action-btn flex items-center gap-2 px-2 py-1.5 rounded-lg text-white/85 hover:bg-white/10 text-sm text-left transition">🔢 <span data-i18n="solve">Reši zadatak</span></button>
    </div>

    <div class="flex-1"></div>

    <!-- Language toggle -->
    <div class="flex bg-white/10 rounded-lg overflow-hidden mb-2">
      <button id="lang-sr" onclick="setLanguage('sr')"
        class="flex-1 py-1.5 text-xs font-semibold text-white bg-white/20 rounded-md transition">SRP</button>
      <button id="lang-en" onclick="setLanguage('en')"
        class="flex-1 py-1.5 text-xs font-semibold text-white/60 transition">ENG</button>
    </div>

    <!-- Disclaimer -->
    <p id="disclaimer" class="text-white/40 text-[10px] leading-relaxed px-1">
      Ne pišem gotove ispite ni seminarske radove.
    </p>
  </aside>

  <!-- Main -->
  <div class="flex-1 flex flex-col min-w-0 h-full">

    <!-- Top bar -->
    <header class="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shrink-0">
      <div class="flex items-center gap-3">
        <!-- Hamburger (mobile only) -->
        <button onclick="openSidebar()" class="sm:hidden text-slate-500 hover:text-slate-800 text-lg">☰</button>
        <span id="conversation-title" class="text-sm font-medium text-slate-600">Novi razgovor</span>
      </div>
      <div class="flex items-center gap-3">
        <span id="user-email" class="text-xs text-slate-400 hidden sm:block"></span>
        <button onclick="signOut()" class="text-xs text-slate-500 hover:text-slate-800 transition" id="btn-logout">Odjava</button>
      </div>
    </header>

    <!-- Chat area -->
    <div id="chat-messages" class="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col gap-4">

      <!-- Empty state (shown by default, hidden when there are messages) -->
      <div id="empty-state" class="flex flex-col items-center justify-center flex-1 gap-6 text-center py-8">
        <div>
          <p id="greeting" class="text-xl font-semibold text-slate-800">Zdravo! 👋</p>
          <p id="greeting-subtitle" class="text-sm text-slate-500 mt-1 max-w-xs">
            Tvoj stariji kolega za učenje. Postavi pitanje ili odaberi početak:
          </p>
        </div>
        <div class="grid grid-cols-2 gap-2 w-full max-w-sm">
          <button onclick="insertTemplate('tplExplain')"
            class="bg-white border border-slate-200 rounded-xl p-3 text-left text-sm text-slate-700 hover:border-[#1F4E79] hover:shadow-sm transition">
            <strong class="block text-[11px] text-[#1F4E79] font-semibold uppercase tracking-wide mb-1" data-i18n="explain">Objasni</strong>
            <span data-i18n="starterExplain">Objasni mi pojam iz predavanja</span>
          </button>
          <button onclick="insertTemplate('tplExamPrep')"
            class="bg-white border border-slate-200 rounded-xl p-3 text-left text-sm text-slate-700 hover:border-[#1F4E79] hover:shadow-sm transition">
            <strong class="block text-[11px] text-[#1F4E79] font-semibold uppercase tracking-wide mb-1" data-i18n="examPrep">Priprema za ispit</strong>
            <span data-i18n="starterExamQuestions">Napravi 10 pitanja za vežbu</span>
          </button>
          <button onclick="insertTemplate('tplEssay')"
            class="bg-white border border-slate-200 rounded-xl p-3 text-left text-sm text-slate-700 hover:border-[#1F4E79] hover:shadow-sm transition">
            <strong class="block text-[11px] text-[#1F4E79] font-semibold uppercase tracking-wide mb-1" data-i18n="essay">Seminarski</strong>
            <span data-i18n="starterEssay">Pomozi mi da strukturišem seminarski</span>
          </button>
          <button onclick="insertTemplate('tplSolve')"
            class="bg-white border border-slate-200 rounded-xl p-3 text-left text-sm text-slate-700 hover:border-[#1F4E79] hover:shadow-sm transition">
            <strong class="block text-[11px] text-[#1F4E79] font-semibold uppercase tracking-wide mb-1" data-i18n="solve">Reši zadatak</strong>
            <span data-i18n="starterSolve">Prođi korak po korak</span>
          </button>
        </div>
      </div>
    </div>

    <!-- PDF preview bar (hidden until PDF attached) -->
    <div id="pdf-bar" class="hidden px-4 py-2 bg-blue-50 border-t border-blue-100 flex items-center gap-2 text-sm text-blue-700">
      📎 <span id="pdf-name"></span>
      <button onclick="removePdf()" class="ml-auto text-blue-500 hover:text-blue-700 text-xs font-medium" data-i18n="removePdf">Ukloni</button>
    </div>

    <!-- Input bar -->
    <div class="px-4 py-3 bg-white border-t border-slate-200 shrink-0">
      <div class="flex items-end gap-2 bg-slate-100 border border-slate-200 rounded-xl px-3 py-2">
        <textarea id="message-input" rows="1"
          class="flex-1 bg-transparent border-none outline-none text-sm text-slate-800 resize-none leading-relaxed max-h-32"
          placeholder="Postavi pitanje ili priloži PDF..."
          onkeydown="handleInputKeydown(event)"
          oninput="autoResize(this)"></textarea>
        <input type="file" id="pdf-input" accept=".pdf" class="hidden" onchange="handlePdfSelect(event)">
        <button onclick="document.getElementById('pdf-input').click()"
          class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg transition shrink-0 text-base">📎</button>
        <button onclick="sendMessage()" id="send-btn"
          class="w-8 h-8 flex items-center justify-center bg-[#1F4E79] text-white rounded-lg hover:bg-[#1a4268] transition shrink-0 font-bold text-sm">↑</button>
      </div>
      <p class="text-center text-[10px] text-slate-400 mt-1.5" id="footer-disclaimer">
        StudyBuddy može da greši. Uvek proveri važne informacije.
      </p>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="/js/i18n.js"></script>
  <script src="/js/auth.js"></script>
  <script src="/js/chat.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: chat page HTML structure with sidebar, empty state, and input bar"
```

---

## Task 11: Chat page logic

**Files:**
- Create: `public/js/chat.js`

- [ ] **Step 1: Create public/js/chat.js**

```javascript
/* global sb, I18N, marked, getSession, requireSession, signOut, getAccessToken */

// ── State ──────────────────────────────────────────────────────────────────
let currentLang = navigator.language.startsWith('sr') ? 'sr' : 'en'
let currentConversationId = null
let currentMessages = [] // [{ role, content, hasPdf }]
let conversations = []   // sidebar list
let attachedPdf = null   // { name, base64 } | null
let isSending = false

// ── Boot ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const session = await requireSession()
  if (!session) return

  const email = session.user.email
  const username = email.split('@')[0]
  document.getElementById('user-email').textContent = email
  document.getElementById('greeting').textContent = `${I18N[currentLang].greeting}, ${username}! 👋`
  document.getElementById('greeting-subtitle').textContent = I18N[currentLang].greetingSubtitle

  applyLanguage(currentLang)
  await loadConversations()
})

// ── Language ───────────────────────────────────────────────────────────────
function setLanguage(lang) {
  currentLang = lang
  applyLanguage(lang)
}

function applyLanguage(lang) {
  const t = I18N[lang]

  // Toggle button styles
  document.getElementById('lang-sr').className = lang === 'sr'
    ? 'flex-1 py-1.5 text-xs font-semibold text-white bg-white/20 rounded-md transition'
    : 'flex-1 py-1.5 text-xs font-semibold text-white/60 transition'
  document.getElementById('lang-en').className = lang === 'en'
    ? 'flex-1 py-1.5 text-xs font-semibold text-white bg-white/20 rounded-md transition'
    : 'flex-1 py-1.5 text-xs font-semibold text-white/60 transition'

  // UI strings via data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n
    if (t[key]) el.textContent = t[key]
  })

  document.getElementById('btn-new-chat').textContent = t.newChat
  document.getElementById('disclaimer').textContent = t.disclaimer
  document.getElementById('message-input').placeholder = t.inputPlaceholder
  document.getElementById('btn-logout').textContent = t.logout
  document.getElementById('greeting').textContent =
    `${t.greeting}, ${document.getElementById('user-email').textContent.split('@')[0]}! 👋`
  document.getElementById('greeting-subtitle').textContent = t.greetingSubtitle
}

// ── Sidebar mobile ─────────────────────────────────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.remove('-translate-x-full')
  document.getElementById('mobile-overlay').classList.remove('hidden')
}

function closeSidebar() {
  document.getElementById('sidebar').classList.add('-translate-x-full')
  document.getElementById('mobile-overlay').classList.add('hidden')
}

// ── Conversations ──────────────────────────────────────────────────────────
async function loadConversations() {
  const token = getAccessToken()
  if (!token) return

  const res = await fetch('/api/history', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) return

  conversations = await res.json()
  renderConversationList()
}

function renderConversationList() {
  const section = document.getElementById('history-section')
  const list = document.getElementById('history-list')
  list.innerHTML = ''

  if (conversations.length === 0) {
    section.classList.add('hidden')
    return
  }

  section.classList.remove('hidden')
  conversations.forEach(conv => {
    const btn = document.createElement('button')
    btn.className = `flex items-center gap-2 px-2 py-1.5 rounded-lg text-white/80 hover:bg-white/10 text-xs text-left transition w-full truncate${conv.id === currentConversationId ? ' bg-white/15' : ''}`
    btn.textContent = conv.title
    btn.onclick = () => loadConversation(conv.id)
    list.appendChild(btn)
  })
}

async function loadConversation(id) {
  const token = getAccessToken()
  if (!token) return

  const res = await fetch(`/api/history/${id}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) return

  const { conversation, messages } = await res.json()
  currentConversationId = id
  currentLang = conversation.language || 'sr'
  currentMessages = messages.map(m => ({ role: m.role, content: m.content, hasPdf: m.has_pdf }))

  document.getElementById('conversation-title').textContent = conversation.title
  document.getElementById('empty-state').classList.add('hidden')

  // Remove old message bubbles (keep empty state div in DOM)
  document.querySelectorAll('.chat-bubble-row').forEach(el => el.remove())
  currentMessages.forEach(m => appendBubble(m.role, m.content))

  renderConversationList()
  closeSidebar()
  scrollToBottom()
}

// ── New chat ───────────────────────────────────────────────────────────────
function startNewChat() {
  currentConversationId = null
  currentMessages = []
  attachedPdf = null
  document.getElementById('pdf-bar').classList.add('hidden')
  document.getElementById('conversation-title').textContent = I18N[currentLang].newChat
  document.querySelectorAll('.chat-bubble-row').forEach(el => el.remove())
  document.getElementById('empty-state').classList.remove('hidden')
  document.getElementById('message-input').value = ''
  renderConversationList()
  closeSidebar()
}

// ── Quick actions ──────────────────────────────────────────────────────────
function insertTemplate(key) {
  const input = document.getElementById('message-input')
  input.value = I18N[currentLang][key]
  input.focus()
  autoResize(input)
  closeSidebar()
}

// ── PDF handling ───────────────────────────────────────────────────────────
function handlePdfSelect(event) {
  const file = event.target.files[0]
  if (!file) return

  const MAX_BYTES = 20 * 1024 * 1024
  if (file.size > MAX_BYTES) {
    showError(I18N[currentLang].fileTooLarge)
    return
  }

  const reader = new FileReader()
  reader.onload = (e) => {
    const base64 = e.target.result.split(',')[1]
    attachedPdf = { name: file.name, base64 }
    document.getElementById('pdf-name').textContent = `${I18N[currentLang].pdfAttached}: ${file.name}`
    document.getElementById('pdf-bar').classList.remove('hidden')
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}

function removePdf() {
  attachedPdf = null
  document.getElementById('pdf-bar').classList.add('hidden')
}

// ── Send message ───────────────────────────────────────────────────────────
function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

async function sendMessage() {
  if (isSending) return
  const input = document.getElementById('message-input')
  const text = input.value.trim()
  if (!text) return

  const token = getAccessToken()
  if (!token) {
    window.location.href = '/login.html'
    return
  }

  isSending = true
  input.value = ''
  autoResize(input)
  document.getElementById('empty-state').classList.add('hidden')

  // Show user bubble
  const userMsg = { role: 'user', content: text, hasPdf: !!attachedPdf }
  currentMessages.push(userMsg)
  appendBubble('user', text)

  // Show empty assistant bubble
  const assistantRow = createBubbleRow('assistant')
  const bubble = assistantRow.querySelector('.msg-bubble')
  document.getElementById('chat-messages').appendChild(assistantRow)
  scrollToBottom()

  const pdf = attachedPdf?.base64 || null
  removePdf()

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: currentMessages.slice(0, -1).concat({ role: 'user', content: text }),
        language: currentLang,
        pdf
      })
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      if (res.status === 401) {
        window.location.href = '/login.html'
        return
      }
      bubble.textContent = I18N[currentLang].aiError
      isSending = false
      return
    }

    const fullText = await consumeStream(res, bubble)
    const assistantMsg = { role: 'assistant', content: fullText, hasPdf: false }
    currentMessages.push(assistantMsg)

    // Save to history
    await saveExchange([userMsg, assistantMsg], token)

  } catch {
    if (navigator.onLine === false) {
      bubble.textContent = I18N[currentLang].networkError
    } else {
      bubble.textContent = I18N[currentLang].aiError
    }
  } finally {
    isSending = false
  }
}

async function consumeStream(response, bubble) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6))
        if (event.type === 'text') {
          fullText += event.text
          bubble.innerHTML = marked.parse(fullText)
          scrollToBottom()
        }
        if (event.type === 'error') {
          bubble.textContent = event.message
        }
      } catch {}
    }
  }

  return fullText
}

// ── History persistence ────────────────────────────────────────────────────
async function saveExchange(newMessages, token) {
  const body = {
    conversationId: currentConversationId,
    language: currentLang,
    messages: newMessages.map(m => ({ role: m.role, content: m.content, has_pdf: m.hasPdf || false }))
  }

  const res = await fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  })

  if (res.ok) {
    const { conversationId } = await res.json()
    if (!currentConversationId) {
      currentConversationId = conversationId
      const title = newMessages[0].content.slice(0, 50)
      document.getElementById('conversation-title').textContent = title
    }
    await loadConversations()
  }
}

// ── Bubble rendering ───────────────────────────────────────────────────────
function createBubbleRow(role) {
  const row = document.createElement('div')
  row.className = `chat-bubble-row flex gap-3 ${role === 'user' ? 'flex-row-reverse' : ''}`

  const avatar = document.createElement('div')
  avatar.className = `w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${role === 'user' ? 'bg-[#1F4E79] text-white' : 'bg-blue-100 text-[#1F4E79]'}`
  avatar.textContent = role === 'user' ? 'Ti' : 'SB'

  const bubble = document.createElement('div')
  bubble.className = `msg-bubble max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${role === 'user' ? 'bg-[#1F4E79] text-white' : 'bg-white border border-slate-200 text-slate-800'}`

  row.appendChild(avatar)
  row.appendChild(bubble)
  return row
}

function appendBubble(role, content) {
  const row = createBubbleRow(role)
  const bubble = row.querySelector('.msg-bubble')
  if (role === 'assistant') {
    bubble.innerHTML = marked.parse(content)
  } else {
    bubble.textContent = content
  }
  document.getElementById('chat-messages').appendChild(row)
  scrollToBottom()
}

// ── Utilities ──────────────────────────────────────────────────────────────
function scrollToBottom() {
  const el = document.getElementById('chat-messages')
  el.scrollTop = el.scrollHeight
}

function autoResize(el) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 128) + 'px'
}

function showError(msg) {
  alert(msg) // simple for MVP; can be replaced with a toast
}
```

- [ ] **Step 2: Manually test the full chat flow**

```bash
node server.js
```

Open `http://localhost:3000` and verify:

1. Unauthenticated visit → redirected to `/login.html` ✓
2. Log in → redirected to `/` with greeting "Zdravo, [username]!" ✓
3. Empty state shows 4 starter cards ✓
4. Clicking a starter card inserts template into input box ✓
5. Sidebar quick-action buttons insert templates ✓
6. Type a question and press Enter → user bubble appears, then assistant streams response ✓
7. Response renders Markdown (bold text, lists, code blocks) ✓
8. After response, conversation appears in sidebar history ✓
9. Click a past conversation → messages load correctly ✓
10. Attach a PDF → PDF bar shows filename ✓
11. Send a message with PDF → assistant responds about the PDF content ✓
12. Language toggle SRP / ENG → UI strings change ✓
13. "Novi razgovor" button clears the chat ✓
14. Logout button → redirected to login page ✓

- [ ] **Step 3: Commit**

```bash
git add public/js/chat.js
git commit -m "feat: full chat page logic — streaming, history, PDF, i18n"
```

---

## Task 12: Mobile responsiveness

**Files:**
- Modify: `public/index.html` (verify CSS is correct, test hamburger)

- [ ] **Step 1: Verify mobile layout manually**

Open DevTools in Chrome (F12) → Toggle device toolbar (Ctrl+Shift+M) → set to 390×844 (iPhone 14 size).

Verify:
- Sidebar is hidden by default on mobile ✓
- Hamburger (☰) button is visible in the top bar ✓
- Tapping ☰ slides the sidebar in from the left ✓
- Dark overlay appears behind the sidebar ✓
- Tapping the overlay closes the sidebar ✓
- Clicking a quick action or history item closes the sidebar ✓
- Chat bubbles and input bar are usable at 390px width ✓
- Empty state starter cards display in a 2×2 grid ✓

- [ ] **Step 2: Fix any layout issues found and commit**

```bash
git add public/index.html
git commit -m "fix: verify mobile layout and hamburger menu"
```

---

## Task 13: Vercel deployment config

**Files:**
- Create: `vercel.json`

> **Note on PDF size limits:** Vercel Hobby plan limits request bodies to 4.5 MB. A 20 MB PDF encoded as base64 is ~27 MB, which exceeds this limit. For full PDF support in production, upgrade to Vercel Pro. PDF upload works without restriction when running locally.

- [ ] **Step 1: Create vercel.json**

```json
{
  "version": 2,
  "outputDirectory": "public",
  "functions": {
    "api/**/*.js": {
      "memory": 512,
      "maxDuration": 60
    }
  }
}
```

The `maxDuration: 60` gives streaming responses up to 60 seconds — important for long AI replies. Vercel Hobby caps this at 60s; Pro allows 300s.

- [ ] **Step 2: Verify the Vercel file structure is correct**

Run this check to confirm all Vercel adapter files are in place:

```bash
ls api/
ls api/history/
```

Expected output:
```
api/: chat.js  config.js  history.js
api/history/: [id].js
```

- [ ] **Step 3: Apply the Supabase schema**

This is a one-time manual step done in the Supabase dashboard:

1. Go to your Supabase project → SQL Editor → New query
2. Paste the contents of `supabase/schema.sql`
3. Click Run
4. Expected: two tables created (`conversations`, `messages`) with RLS enabled

- [ ] **Step 4: Set up environment variables locally**

```bash
cp .env.example .env
```

Fill in `.env` with values from:
- `ANTHROPIC_API_KEY` → https://console.anthropic.com → API Keys
- `SUPABASE_URL` → Supabase dashboard → Settings → API → Project URL
- `SUPABASE_ANON_KEY` → Supabase dashboard → Settings → API → anon public
- `SUPABASE_SERVICE_KEY` → Supabase dashboard → Settings → API → service_role secret

- [ ] **Step 5: Run all tests one final time**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 6: Final commit**

```bash
git add vercel.json
git commit -m "feat: Vercel deployment config"
```

- [ ] **Step 7: Deploy to Vercel**

```bash
# Install Vercel CLI if not present
npm install -g vercel

# Deploy (follow the prompts: link to your Vercel account and project)
vercel

# Add environment variables in the Vercel dashboard:
# Project → Settings → Environment Variables → add all 4 from .env
# Then redeploy:
vercel --prod
```

---

## Self-review checklist (completed)

**Spec coverage:**
| Spec requirement | Covered by |
|---|---|
| Auth wall (login/register) | Task 9 |
| Chat page with sidebar + main area | Task 10 |
| Streaming AI responses via SSE | Task 7, Task 11 |
| PDF upload and forwarding to Claude | Task 7, Task 11 |
| Serbian/English i18n toggle | Task 3, Task 11 |
| Quick-action buttons insert templates | Task 10, Task 11 |
| Starter prompt cards on empty state | Task 10, Task 11 |
| Conversation history saved per user | Task 5, Task 6, Task 11 |
| Sidebar history list with past conversations | Task 11 |
| Academic integrity guardrail (system prompt) | Task 7 |
| Mobile-responsive layout + hamburger | Task 10, Task 12 |
| Error messages in Serbian | Task 3, Task 11 |
| Auth middleware guards all API endpoints | Task 4, Task 6, Task 8 |
| Supabase RLS (users see only their own data) | Task 1 (schema) |
| Vercel deployment config | Task 13 |
| Local dev with `node server.js` | Task 2 |

All spec requirements are covered. No TBDs or placeholders remain.
