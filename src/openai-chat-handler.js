const OpenAI = require('openai')
const pdfParse = require('pdf-parse')
const { buildSystemPrompt, validateRequest } = require('./chat-handler')

async function extractPdfText(base64) {
  const buf = Buffer.from(base64, 'base64')
  const { text } = await pdfParse(buf)
  return text.trim()
}

async function buildOpenAIMessages(messages, files = [], language = 'sr') {
  const emptyPlaceholder = language === 'en' ? '[Attached file]' : '[Priložen fajl]'
  const fallbackPrompt = language === 'en' ? 'Analyze the attached material.' : 'Analiziraj priloženi materijal.'
  const imageHint = '[MANDATORY: An image has been uploaded. You MUST transcribe ALL visible text exactly before answering — including handwritten text, numbers, formulas, and labels. Flag any unclear parts explicitly.]'

  const pdfs = files.filter(f => f.mediaType === 'application/pdf')
  const images = files.filter(f => f.mediaType !== 'application/pdf')

  let pdfText = ''
  for (const pdf of pdfs) {
    const text = await extractPdfText(pdf.base64)
    pdfText += `\n\n[PDF CONTENT START]\n${text}\n[PDF CONTENT END]`
  }

  const result = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const content = m.content || emptyPlaceholder
    const isLastUser = m.role === 'user' && !messages.slice(i + 1).some(x => x.role === 'user')

    if (!isLastUser || !files.length) {
      result.push({ role: m.role, content })
      continue
    }

    const userText = (m.content || '').trim()
    const hasImages = images.length > 0
    const hasPdfs = pdfs.length > 0

    let fullText = userText || fallbackPrompt
    if (hasPdfs) fullText = `${fullText}${pdfText}`
    if (hasImages) fullText = `${imageHint}\n${fullText}`

    const parts = [{ type: 'text', text: fullText }]
    for (const f of images) {
      parts.push({ type: 'image_url', image_url: { url: `data:${f.mediaType};base64,${f.base64}` } })
    }

    result.push({ role: m.role, content: parts })
  }
  return result
}

async function handleChat(req, res, openaiClient) {
  const validationError = validateRequest(req.body)
  if (validationError) return res.status(400).json({ error: validationError })
  const { messages, language, gender, faculty, studyYear, files: rawFiles = [], claudeModel } = req.body
  const files = Array.isArray(rawFiles) ? rawFiles.filter(f => f && f.base64 && f.mediaType) : []
  const client = openaiClient || new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const contextLimit = files.length > 0 ? 8 : 20
  const recentMessages = messages.slice(-contextLimit)
  const openaiMessages = await buildOpenAIMessages(recentMessages, files, language)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = await client.chat.completions.stream({
      model: 'gpt-5.4-mini',
      max_completion_tokens: 8192,
      messages: [{ role: 'system', content: buildSystemPrompt(gender, faculty, studyYear, language) }, ...openaiMessages]
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
