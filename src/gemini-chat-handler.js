const { GoogleGenerativeAI } = require('@google/generative-ai')
const { buildSystemPrompt, validateRequest } = require('./chat-handler')

function buildGeminiHistory(messages, language = 'sr') {
  const emptyPlaceholder = language === 'en' ? '[Attached file]' : '[Priložen fajl]'
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content || emptyPlaceholder }]
  }))
}

function buildGeminiParts(message, files = [], language = 'sr') {
  const fallbackPrompt = language === 'en' ? 'Analyze the attached material.' : 'Analiziraj priloženi materijal.'
  const fileHint = '[MANDATORY: A file has been uploaded. You MUST transcribe ALL visible text exactly before answering — including handwritten text, numbers, formulas, and labels. Flag any unclear parts explicitly. Never guess at unclear content.]'

  if (!files.length) return [{ text: message.content || '' }]

  const userText = (message.content || '').trim()
  const fullText = userText.length < 10
    ? `${fileHint}\n${userText || fallbackPrompt}`
    : `${fileHint}\n${userText}`

  const parts = [{ text: fullText }]
  for (const f of files) {
    parts.push({ inlineData: { mimeType: f.mediaType, data: f.base64 } })
  }
  return parts
}

async function handleChat(req, res, geminiClient) {
  const validationError = validateRequest(req.body)
  if (validationError) return res.status(400).json({ error: validationError })
  const { messages, language, gender, faculty, studyYear, files: rawFiles = [] } = req.body
  const files = Array.isArray(rawFiles) ? rawFiles.filter(f => f && f.base64 && f.mediaType) : []
  const genAI = geminiClient || new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const contextLimit = files.length > 0 ? 8 : 20
  const recentMessages = messages.slice(-contextLimit)

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash', systemInstruction: buildSystemPrompt(gender, faculty, studyYear) })
  const history = buildGeminiHistory(recentMessages.slice(0, -1), language)
  const lastMessage = recentMessages[recentMessages.length - 1]
  const parts = buildGeminiParts(lastMessage, files, language)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const chat = model.startChat({ history })
    const result = await chat.sendMessageStream(parts)

    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`)
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  } catch (err) {
    console.error('gemini handleChat error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'AI service error.' })
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Nešto nije u redu sa asistentom. Pokušaj za koji trenutak.' })}\n\n`)
      res.end()
    }
  }
}

module.exports = { handleChat, buildGeminiHistory, buildGeminiParts }
