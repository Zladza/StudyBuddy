# OpenAI Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GPT-4o as a selectable AI provider alongside Claude, with a persistent Settings toggle and PDF upload blocked for OpenAI.

**Architecture:** New `src/openai-chat-handler.js` mirrors the Anthropic handler; `api/chat.js` and `server.js` route by `provider` field in the request body. Frontend adds a provider toggle to the Settings panel, persists to `localStorage`, and blocks PDF upload when OpenAI is selected.

**Tech Stack:** Node.js, `openai` npm package, Express, Vercel serverless, Tailwind CSS, vanilla JS.

---

### Task 1: Install openai package and export SYSTEM_PROMPT from chat-handler

**Files:**
- Modify: `package.json`
- Modify: `src/chat-handler.js` (already exports SYSTEM_PROMPT — verify and add `provider` to validateRequest)
- Modify: `tests/chat-handler.test.js`

- [ ] **Step 1: Install the openai package**

```bash
cd /Users/zlatko/Desktop/StudyBuddy/.worktrees/feature/openai-provider
npm install openai
```

Expected: `openai` appears in `package.json` dependencies.

- [ ] **Step 2: Verify SYSTEM_PROMPT is exported from chat-handler.js**

Check the bottom of `src/chat-handler.js`:
```js
module.exports = { handleChat, validateRequest, buildMessages, SYSTEM_PROMPT }
```
It already exports `SYSTEM_PROMPT`. No change needed here.

- [ ] **Step 3: Write failing test for validateRequest accepting provider field**

Add to `tests/chat-handler.test.js`:
```js
test('validateRequest accepts valid provider values', () => {
  expect(validateRequest({ messages: [], language: 'sr', provider: 'claude' })).toBeNull()
  expect(validateRequest({ messages: [], language: 'sr', provider: 'openai' })).toBeNull()
})

test('validateRequest rejects invalid provider value', () => {
  expect(validateRequest({ messages: [], language: 'sr', provider: 'gemini' })).toBe('Provider must be claude or openai.')
})

test('validateRequest accepts missing provider (defaults to claude)', () => {
  expect(validateRequest({ messages: [], language: 'sr' })).toBeNull()
})
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=tests/chat-handler
```

Expected: 2 new tests FAIL ("Provider must be claude or openai." not returned).

- [ ] **Step 5: Add provider validation to validateRequest in src/chat-handler.js**

Replace:
```js
function validateRequest(body) {
  if (!body.messages || !Array.isArray(body.messages)) return 'Messages must be an array.'
  if (!['sr', 'en'].includes(body.language)) return 'Language must be sr or en.'
  return null
}
```

With:
```js
function validateRequest(body) {
  if (!body.messages || !Array.isArray(body.messages)) return 'Messages must be an array.'
  if (!['sr', 'en'].includes(body.language)) return 'Language must be sr or en.'
  if (body.provider !== undefined && !['claude', 'openai'].includes(body.provider)) return 'Provider must be claude or openai.'
  return null
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=tests/chat-handler
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/chat-handler.js tests/chat-handler.test.js
git commit -m "feat: install openai package and add provider validation to validateRequest"
```

---

### Task 2: Create src/openai-chat-handler.js

**Files:**
- Create: `src/openai-chat-handler.js`
- Create: `tests/openai-chat-handler.test.js`

- [ ] **Step 1: Write the test file first**

Create `tests/openai-chat-handler.test.js`:
```js
const { buildOpenAIMessages } = require('../src/openai-chat-handler')

test('buildOpenAIMessages returns plain messages when no files', () => {
  const input = [
    { role: 'user', content: 'Objasni mi Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ]
  expect(buildOpenAIMessages(input, [])).toEqual([
    { role: 'user', content: 'Objasni mi Thevenina' },
    { role: 'assistant', content: 'Theveninova teorema...' }
  ])
})

test('buildOpenAIMessages defaults to empty files when omitted', () => {
  const input = [{ role: 'user', content: 'test' }]
  expect(buildOpenAIMessages(input)).toEqual([{ role: 'user', content: 'test' }])
})

test('buildOpenAIMessages fills empty content with sr placeholder', () => {
  const input = [{ role: 'user', content: '' }]
  expect(buildOpenAIMessages(input, [], 'sr')[0].content).toBe('[Priložen fajl]')
})

test('buildOpenAIMessages fills empty content with en placeholder', () => {
  const input = [{ role: 'user', content: '' }]
  expect(buildOpenAIMessages(input, [], 'en')[0].content).toBe('[Attached file]')
})

test('buildOpenAIMessages wraps last user message with image_url block', () => {
  const input = [{ role: 'user', content: 'Šta je ovo?' }]
  const result = buildOpenAIMessages(input, [{ base64: 'imgdata==', mediaType: 'image/jpeg', name: 'foto.jpg' }])
  expect(result[0].content[0]).toEqual({ type: 'text', text: expect.stringContaining('Šta je ovo?') })
  expect(result[0].content[1]).toEqual({
    type: 'image_url',
    image_url: { url: 'data:image/jpeg;base64,imgdata==' }
  })
})

test('buildOpenAIMessages uses sr fallback when content empty and files present', () => {
  const input = [{ role: 'user', content: '' }]
  const result = buildOpenAIMessages(input, [{ base64: 'img==', mediaType: 'image/png', name: 'f.png' }], 'sr')
  expect(result[0].content[0].text).toContain('Analiziraj priloženi materijal.')
})

test('buildOpenAIMessages uses en fallback when content empty and files present', () => {
  const input = [{ role: 'user', content: '' }]
  const result = buildOpenAIMessages(input, [{ base64: 'img==', mediaType: 'image/png', name: 'f.png' }], 'en')
  expect(result[0].content[0].text).toContain('Analyze the attached material.')
})

test('buildOpenAIMessages only wraps last user message', () => {
  const input = [
    { role: 'user', content: 'First message' },
    { role: 'assistant', content: 'Reply' },
    { role: 'user', content: 'Second message' }
  ]
  const result = buildOpenAIMessages(input, [{ base64: 'img==', mediaType: 'image/jpeg', name: 'f.jpg' }])
  expect(typeof result[0].content).toBe('string')
  expect(Array.isArray(result[2].content)).toBe(true)
})

test('handleChat streams text chunks and ends with done', async () => {
  const { handleChat } = require('../src/openai-chat-handler')

  const chunks = [
    { choices: [{ delta: { content: 'Hello' } }] },
    { choices: [{ delta: { content: ' world' } }] },
    { choices: [{ delta: {} }] }
  ]

  const mockStream = {
    [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c }
  }

  const mockClient = {
    chat: { completions: { stream: jest.fn().mockResolvedValue(mockStream) } }
  }

  const written = []
  const req = { body: { messages: [{ role: 'user', content: 'Hi' }], language: 'sr', files: [] } }
  const res = {
    setHeader: jest.fn(),
    write: jest.fn(d => written.push(d)),
    end: jest.fn(),
    headersSent: false
  }

  await handleChat(req, res, mockClient)

  expect(written.some(d => d.includes('"type":"text"'))).toBe(true)
  expect(written.some(d => d.includes('"type":"done"'))).toBe(true)
  expect(res.end).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=tests/openai-chat-handler
```

Expected: all FAIL — module not found.

- [ ] **Step 3: Create src/openai-chat-handler.js**

```js
const OpenAI = require('openai')
const { SYSTEM_PROMPT } = require('./chat-handler')

function buildOpenAIMessages(messages, files = [], language = 'sr') {
  const emptyPlaceholder = language === 'en' ? '[Attached file]' : '[Priložen fajl]'
  const fallbackPrompt = language === 'en' ? 'Analyze the attached material.' : 'Analiziraj priloženi materijal.'
  const fileHint = '[MANDATORY: An image has been uploaded. You MUST transcribe ALL visible text exactly before answering — including handwritten text, numbers, formulas, and labels. Flag any unclear parts explicitly. Never guess at unclear content.]'

  return messages.map((m, i) => {
    const content = m.content || emptyPlaceholder
    const isLastUser = m.role === 'user' && !messages.slice(i + 1).some(x => x.role === 'user')

    if (!isLastUser || !files.length) return { role: m.role, content }

    const userText = (m.content || '').trim()
    const fullText = userText.length < 10
      ? `${fileHint}\n${userText || fallbackPrompt}`
      : `${fileHint}\n${userText}`

    const parts = [{ type: 'text', text: fullText }]
    for (const f of files) {
      parts.push({ type: 'image_url', image_url: { url: `data:${f.mediaType};base64,${f.base64}` } })
    }
    return { role: m.role, content: parts }
  })
}

async function handleChat(req, res, openaiClient) {
  const { messages, language, files: rawFiles = [] } = req.body
  const files = Array.isArray(rawFiles) ? rawFiles.filter(f => f && f.base64 && f.mediaType) : []
  const client = openaiClient || new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const contextLimit = files.length > 0 ? 8 : 20
  const recentMessages = messages.slice(-contextLimit)
  const openaiMessages = buildOpenAIMessages(recentMessages, files, language)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = await client.chat.completions.stream({
      model: 'gpt-4o',
      max_tokens: 8192,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...openaiMessages]
    })

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content
      if (text) res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`)
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  } catch (err) {
    console.error('openai handleChat error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'AI service error.' })
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Nešto nije u redu sa asistentom. Pokušaj za koji trenutak.' })}\n\n`)
      res.end()
    }
  }
}

module.exports = { handleChat, buildOpenAIMessages }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=tests/openai-chat-handler
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/openai-chat-handler.js tests/openai-chat-handler.test.js
git commit -m "feat: add OpenAI GPT-4o chat handler with buildOpenAIMessages"
```

---

### Task 3: Route by provider in api/chat.js and server.js

**Files:**
- Modify: `api/chat.js`
- Modify: `server.js`

- [ ] **Step 1: Update api/chat.js to route by provider**

Replace the full contents of `api/chat.js`:
```js
const { makeAuthMiddleware } = require('../src/auth-middleware')
const { handleChat: handleClaude } = require('../src/chat-handler')
const { handleChat: handleOpenAI } = require('../src/openai-chat-handler')

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
  const provider = req.body?.provider || 'claude'
  return provider === 'openai' ? handleOpenAI(req, res) : handleClaude(req, res)
}
```

- [ ] **Step 2: Update server.js to route by provider**

Find the chat route in `server.js`:
```js
const { handleChat } = require('./src/chat-handler')
// ...
app.post('/api/chat', requireAuth, (req, res) => handleChat(req, res))
```

Replace with:
```js
const { handleChat: handleClaude } = require('./src/chat-handler')
const { handleChat: handleOpenAI } = require('./src/openai-chat-handler')
// ...
app.post('/api/chat', requireAuth, (req, res) => {
  const provider = req.body?.provider || 'claude'
  return provider === 'openai' ? handleOpenAI(req, res) : handleClaude(req, res)
})
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add api/chat.js server.js
git commit -m "feat: route /api/chat to openai or claude handler based on provider field"
```

---

### Task 4: Frontend HTML — add provider selector to settings modal

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add provider selector block inside the settings modal**

In `public/index.html`, find the language section (ends just before the border-t div):
```html
      <div class="mb-4">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-2" data-i18n="language">Jezik</p>
        <div class="flex bg-slate-100 dark:bg-gray-700 rounded-lg overflow-hidden p-1 gap-1">
          <button id="settings-lang-sr" onclick="setLanguage('sr')"
            class="flex-1 py-1.5 text-xs font-semibold rounded-md transition">SRP</button>
          <button id="settings-lang-en" onclick="setLanguage('en')"
            class="flex-1 py-1.5 text-xs font-semibold rounded-md transition">ENG</button>
        </div>
      </div>
      <div class="border-t border-slate-100 dark:border-gray-700 pt-4 mt-2">
```

Insert after the language `</div>` and before `<div class="border-t...">`:
```html
      <div class="mb-4">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-2" data-i18n="providerLabel">Model</p>
        <div class="flex bg-slate-100 dark:bg-gray-700 rounded-lg overflow-hidden p-1 gap-1">
          <button id="settings-provider-claude" onclick="setProvider('claude')"
            class="flex-1 py-1.5 text-xs font-semibold rounded-md transition" data-i18n="providerClaude">Claude</button>
          <button id="settings-provider-openai" onclick="setProvider('openai')"
            class="flex-1 py-1.5 text-xs font-semibold rounded-md transition" data-i18n="providerGPT4o">GPT-4o</button>
        </div>
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add provider selector to settings modal"
```

---

### Task 5: Frontend JS — currentProvider, setProvider, applyProvider, send, block PDF

**Files:**
- Modify: `public/js/chat.js`
- Modify: `public/js/i18n.js`

- [ ] **Step 1: Add 4 new I18N keys to i18n.js**

In `public/js/i18n.js`, in the `sr` object, add after `fileResolveFailed`:
```js
    providerLabel: 'Model',
    providerClaude: 'Claude',
    providerGPT4o: 'GPT-4o',
    pdfNotSupportedOpenAI: 'PDF nije podržan sa GPT-4o. Koristi Claude za PDF fajlove.',
```

In the `en` object, add after `fileResolveFailed`:
```js
    providerLabel: 'Model',
    providerClaude: 'Claude',
    providerGPT4o: 'GPT-4o',
    pdfNotSupportedOpenAI: 'PDF is not supported with GPT-4o. Switch to Claude for PDF files.',
```

- [ ] **Step 2: Add currentProvider state variable at top of chat.js**

Find (line ~4):
```js
let currentLang = localStorage.getItem('sb-lang') || (navigator.language.startsWith('sr') ? 'sr' : 'en')
```

Add directly after:
```js
let currentProvider = localStorage.getItem('sb-provider') || 'claude'
```

- [ ] **Step 3: Add setProvider and updateProviderButtons functions**

Find `function updateLanguageButtons() {` and add directly after its closing `}`:
```js
function setProvider(provider) {
  currentProvider = provider
  localStorage.setItem('sb-provider', provider)
  updateProviderButtons()
}

function updateProviderButtons() {
  const claudeBtn = document.getElementById('settings-provider-claude')
  const openaiBtn = document.getElementById('settings-provider-openai')
  if (!claudeBtn || !openaiBtn) return
  const activeClass = 'flex-1 py-1.5 text-xs font-semibold rounded-md transition bg-white dark:bg-gray-800 text-slate-800 dark:text-gray-100 shadow-sm'
  const inactiveClass = 'flex-1 py-1.5 text-xs font-semibold rounded-md transition text-slate-500 dark:text-gray-400'
  claudeBtn.className = currentProvider === 'claude' ? activeClass : inactiveClass
  openaiBtn.className = currentProvider === 'openai' ? activeClass : inactiveClass
}
```

- [ ] **Step 4: Call updateProviderButtons() from applyLanguage()**

In `applyLanguage()`, find the line:
```js
  updateLanguageButtons()
```

Add directly after:
```js
  updateProviderButtons()
```

- [ ] **Step 5: Call updateProviderButtons() on app init**

Find where `applyLanguage(currentLang)` is called on startup (inside the auth init / `onAuthSuccess` function, around line 50):
```js
  applyLanguage(currentLang)
```

Add directly after:
```js
  updateProviderButtons()
```

- [ ] **Step 6: Block PDF upload when provider is openai**

In `handlePdfSelect`, find the size check line:
```js
  if (file.size > 20 * 1024 * 1024) { showError(I18N[currentLang].fileTooLarge); return }
```

Add directly before it:
```js
  if (currentProvider === 'openai') { showError(I18N[currentLang].pdfNotSupportedOpenAI); return }
```

- [ ] **Step 7: Send provider with every chat request**

In `sendMessage()`, find:
```js
      body: JSON.stringify({
        messages: currentMessages.slice(0, -1).concat({ role: 'user', content: text }),
        language: currentLang,
        files: filesToSend.map(f => ({ base64: f.base64, mediaType: f.mime_type, name: f.name }))
      }),
```

Replace with:
```js
      body: JSON.stringify({
        messages: currentMessages.slice(0, -1).concat({ role: 'user', content: text }),
        language: currentLang,
        provider: currentProvider,
        files: filesToSend.map(f => ({ base64: f.base64, mediaType: f.mime_type, name: f.name }))
      }),
```

- [ ] **Step 8: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add public/js/chat.js public/js/i18n.js
git commit -m "feat: add provider toggle to frontend — currentProvider, setProvider, PDF block for OpenAI"
```
