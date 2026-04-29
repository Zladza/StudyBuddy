const Anthropic = require('@anthropic-ai/sdk')

async function handleFollowup(req, res) {
  const { messages, language } = req.body
  if (!Array.isArray(messages) || messages.length < 2) {
    return res.json({ questions: [] })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const lang = language === 'en' ? 'English' : 'Serbian Latin script'

  try {
    const lastTwo = messages.slice(-2).map(m => `${m.role}: ${String(m.content).slice(0, 400)}`).join('\n\n')
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Based on this exchange, give 3 short follow-up study questions in ${lang}. Return ONLY a JSON array of 3 strings, nothing else.\n\n${lastTwo}`
      }]
    })

    const text = response.content[0].text.trim()
    const match = text.match(/\[[\s\S]*?\]/)
    const questions = match ? JSON.parse(match[0]) : []
    res.json({ questions: Array.isArray(questions) ? questions.slice(0, 3) : [] })
  } catch (err) {
    console.error('handleFollowup error:', err)
    res.json({ questions: [] })
  }
}

module.exports = { handleFollowup }
