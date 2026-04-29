const Anthropic = require('@anthropic-ai/sdk')

async function handleGlossary(req, res) {
  const { messages, language } = req.body
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Invalid' })

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const context = messages.filter(m => m.role === 'assistant' && !String(m.content).startsWith('{"__tool__":')).slice(-5).map(m => m.content).join('\n\n')
  const lang = language === 'sr' ? 'Serbian in Latin script' : 'English'

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Extract 8-12 key academic terms from this study material and write clear, concise definitions in ${lang}. Return ONLY a valid JSON array with no extra text:
[{"term":"Term name","definition":"Clear definition in 1-2 sentences."}]

Material:
${context}`
      }]
    })

    const text = msg.content[0].text
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return res.json({ terms: [] })
    const terms = JSON.parse(match[0])
    res.json({ terms })
  } catch {
    res.json({ terms: [] })
  }
}

module.exports = { handleGlossary }
