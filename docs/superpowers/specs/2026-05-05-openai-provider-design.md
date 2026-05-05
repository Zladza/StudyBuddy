# OpenAI Provider Support Design

## Goal

Add GPT-4o as a selectable AI provider alongside Claude. Users pick their preferred model once in Settings; the choice persists across sessions.

## Architecture

Provider selection lives in the Settings panel (same as language toggle). A `currentProvider` variable in `chat.js` mirrors `currentLang` — read from `localStorage` on load, written on change. Every `/api/chat` request includes `provider: currentProvider`. The backend routes to the correct handler based on that field.

Two handler files, each responsible for one provider:
- `src/chat-handler.js` — Anthropic/Claude (existing, minimal changes)
- `src/openai-chat-handler.js` — OpenAI/GPT-4o (new)

`api/chat.js` and `server.js` import both and route by `provider`.

## File Structure

| File | Change |
|------|--------|
| `src/openai-chat-handler.js` | Create — GPT-4o handler |
| `src/chat-handler.js` | Export `SYSTEM_PROMPT`; accept `provider` in validateRequest |
| `api/chat.js` | Route by provider |
| `server.js` | Route by provider |
| `public/index.html` | Add provider selector to settings modal |
| `public/js/chat.js` | `currentProvider`, localStorage, send with requests, block PDF for OpenAI |
| `public/js/i18n.js` | 4 new keys (sr + en) |
| `tests/openai-chat-handler.test.js` | Create — unit tests |
| `package.json` | Add `openai` dependency |

## Backend Detail

### `src/openai-chat-handler.js`

```js
const OpenAI = require('openai')
const { SYSTEM_PROMPT } = require('./chat-handler')

function buildOpenAIMessages(messages, files = [], language = 'sr') {
  const emptyPlaceholder = language === 'en' ? '[Attached file]' : '[Priložen fajl]'
  const fallbackPrompt = language === 'en' ? 'Analyze the attached material.' : 'Analiziraj priloženi materijal.'

  return messages.map((m, i) => {
    const isLastUser = m.role === 'user' && !messages.slice(i + 1).some(x => x.role === 'user')
    const content = m.content || emptyPlaceholder

    if (!isLastUser || !files.length) return { role: m.role, content }

    const parts = []
    const userText = (m.content || '').trim()
    const fileHint = '[MANDATORY: An image has been uploaded. You MUST transcribe ALL visible text exactly before answering.]'
    parts.push({ type: 'text', text: userText.length < 10 ? `${fileHint}\n${userText || fallbackPrompt}` : `${fileHint}\n${userText}` })
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

### Routing in `api/chat.js` and `server.js`

Both read `req.body.provider` and call the matching handler's `handleChat`.

### `validateRequest` in `chat-handler.js`

Add optional `provider` field validation: must be `'claude'` or `'openai'` if present.

## Frontend Detail

### Settings modal — provider selector

Below the language toggle, add:
```html
<p data-i18n="providerLabel">Model</p>
<button id="settings-provider-claude" onclick="setProvider('claude')">Claude</button>
<button id="settings-provider-openai" onclick="setProvider('openai')">GPT-4o</button>
```

Same active/inactive class pattern as language buttons.

### `chat.js` changes

```js
let currentProvider = localStorage.getItem('sb-provider') || 'claude'

function setProvider(p) {
  currentProvider = p
  localStorage.setItem('sb-provider', p)
  applyProvider()
}

function applyProvider() {
  // update button active states
}
```

`sendMessage()` adds `provider: currentProvider` to the fetch body.

`handlePdfSelect()` — if `currentProvider === 'openai'`, show `I18N[currentLang].pdfNotSupportedOpenAI` error and return.

### I18N keys

| Key | sr | en |
|-----|----|----|
| `providerLabel` | `'Model'` | `'Model'` |
| `providerClaude` | `'Claude'` | `'Claude'` |
| `providerGPT4o` | `'GPT-4o'` | `'GPT-4o'` |
| `pdfNotSupportedOpenAI` | `'PDF nije podržan sa GPT-4o. Koristi Claude za PDF.'` | `'PDF is not supported with GPT-4o. Switch to Claude for PDFs.'` |

## Error Handling

- Invalid `provider` value in request → 400
- `OPENAI_API_KEY` missing → 500 with generic AI error message
- OpenAI rate limit / quota → same error path as Anthropic

## Testing

`tests/openai-chat-handler.test.js` covers:
- `buildOpenAIMessages` plain messages (no files)
- `buildOpenAIMessages` with image — correct `image_url` block format
- `buildOpenAIMessages` language-aware fallback text
- `handleChat` streams correctly (mock openai client)
- `handleChat` handles errors gracefully
