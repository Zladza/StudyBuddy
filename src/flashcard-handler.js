const Anthropic = require('@anthropic-ai/sdk')

async function handleFlashcards(req, res) {
  const { messages, language } = req.body
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No conversation.' })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const lang = language === 'en' ? 'English' : 'Serbian Latin script'

  const context = messages
    .filter(m => m.role === 'assistant' && !String(m.content).startsWith('{"__tool__":'))
    .slice(-5)
    .map(m => String(m.content).slice(0, 600))
    .join('\n\n---\n\n')

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      temperature: 1,
      messages: [{
        role: 'user',
        content: `Create 6-8 study flashcards from this content in ${lang}. Cover different concepts and vary the question types each time. Return ONLY a JSON array: [{"q":"question","a":"answer"},...]. No other text.\n\n${context}`
      }]
    })

    const text = response.content[0].text.trim()
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return res.json({ cards: [] })

    const cards = JSON.parse(match[0])
    res.json({ cards: Array.isArray(cards) ? cards.slice(0, 10) : [] })
  } catch (err) {
    console.error('handleFlashcards error:', err)
    res.status(500).json({ error: 'Could not generate flashcards.' })
  }
}

module.exports = { handleFlashcards }
