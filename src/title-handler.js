const Anthropic = require('@anthropic-ai/sdk')

async function handleTitle(req, res) {
  const { message, language } = req.body
  if (!message) return res.status(400).json({ error: 'Invalid' })

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const lang = language === 'sr' ? 'Serbian in Latin script' : 'English'

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 25,
      messages: [{
        role: 'user',
        content: `Generate a short title (3-5 words) in ${lang} for a study conversation that starts with this student message. Return ONLY the title, no quotes, no punctuation at the end:\n\n${message.slice(0, 300)}`
      }]
    })
    const title = msg.content[0].text.trim().replace(/^["']|["'.!?]$/g, '')
    res.json({ title })
  } catch {
    res.json({ title: null })
  }
}

module.exports = { handleTitle }
