const Anthropic = require('@anthropic-ai/sdk')

async function handleSummary(req, res) {
  const { messages, language } = req.body
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Invalid' })

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const context = messages.filter(m => m.role === 'assistant' && !String(m.content).startsWith('{"__tool__":')).slice(-6).map(m => m.content).join('\n\n')
  const lang = language === 'sr' ? 'Serbian in Latin script' : 'English'

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Create a structured study summary in ${lang} based on this material. Return ONLY a valid JSON object with no extra text:
{"title":"Topic title","keyPoints":["point 1","point 2","point 3","point 4","point 5"],"formulas":["formula or equation if any"],"toRemember":["key thing 1","key thing 2","key thing 3"]}

Rules:
- 5-8 key points, each 1 sentence
- 3-5 things to remember (most important takeaways)
- If no formulas exist in the material, return an empty array for formulas
- Keep all items concise

Material:
${context}`
      }]
    })

    const text = msg.content[0].text
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return res.json({ summary: null })
    const summary = JSON.parse(match[0])
    res.json({ summary })
  } catch {
    res.json({ summary: null })
  }
}

module.exports = { handleSummary }
