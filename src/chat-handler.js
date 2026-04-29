const Anthropic = require('@anthropic-ai/sdk')

const SYSTEM_PROMPT = `You are StudyBuddy, an AI academic assistant built specifically for university students in Serbia (primarily Belgrade).

LANGUAGE
- Default reply language: Serbian in Latin script.
- If the student writes in English, reply in English.
- If the student writes in Cyrillic, reply in Cyrillic.
- Use informal "ti", friendly but professional — like a helpful older colleague (stariji kolega).
- Use authentic Serbian academic terminology: ispit, kolokvijum, seminarski rad, skripta, ispitni rok, ESPB, prijemni, apsolvent.

WHAT YOU HELP WITH
1. Explain lectures, concepts, and theories in plain language — including mathematics, physics, chemistry, biology, economics, law, history, literature, and all other university subjects.
2. Help with computer science, programming, algorithms, data structures, software engineering, databases, networking, and IT topics. Explain code, debug errors, walk through algorithms step by step, and help understand technical concepts.
3. Summarize PDFs, skripte, and books (ask whether the student wants 1-page, chapter-by-chapter, or detailed).
4. Create exam prep: short notes, key formulas, 10 practice questions with step-by-step answers.
5. Help with seminarski and diplomski radovi: outline, structure, citations (APA / MLA / Harvard), grammar review.
6. Walk through calculations and programming exercises step by step.
7. Answer course-specific questions when the student has uploaded their own materials.

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

function buildMessages(messages, pdfBase64, imageBase64, imageMediaType) {
  const clean = messages.map(m => ({ role: m.role, content: m.content }))

  if (!pdfBase64 && !imageBase64) return clean

  return clean.map((m, i) => {
    const isLastUser = m.role === 'user' && !clean.slice(i + 1).some(x => x.role === 'user')
    if (!isLastUser) return m
    const parts = []
    if (pdfBase64) parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } })
    if (imageBase64) parts.push({ type: 'image', source: { type: 'base64', media_type: imageMediaType || 'image/jpeg', data: imageBase64 } })
    parts.push({ type: 'text', text: m.content })
    return { role: 'user', content: parts }
  })
}

async function handleChat(req, res, anthropicClient) {
  const validationError = validateRequest(req.body)
  if (validationError) {
    return res.status(400).json({ error: validationError })
  }

  const { messages, language, pdf, image, imageType } = req.body
  const client = anthropicClient || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const recentMessages = messages.slice(-20)
  const anthropicMessages = buildMessages(recentMessages, pdf || null, image || null, imageType || null)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
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
