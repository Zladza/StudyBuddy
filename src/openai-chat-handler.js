const OpenAI = require('openai')
const { buildSystemPrompt, validateRequest } = require('./chat-handler')

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
  const validationError = validateRequest(req.body)
  if (validationError) return res.status(400).json({ error: validationError })
  const { messages, language, gender, faculty, studyYear, files: rawFiles = [] } = req.body
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
      messages: [{ role: 'system', content: buildSystemPrompt(gender, faculty, studyYear) }, ...openaiMessages]
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
