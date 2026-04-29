const Anthropic = require('@anthropic-ai/sdk')

async function handleQuiz(req, res) {
  const { messages, language } = req.body
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Invalid' })

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const context = messages.filter(m => m.role === 'assistant' && !String(m.content).startsWith('{"__tool__":')).slice(-5).map(m => m.content).join('\n\n')
  const lang = language === 'sr' ? 'Serbian in Latin script' : 'English'

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      temperature: 1,
      messages: [{
        role: 'user',
        content: `Based on this study material, create exactly 10 multiple-choice quiz questions in ${lang}. Each regeneration should pick different angles, sub-topics, and difficulty levels — do not repeat questions from obvious patterns. Place the correct answer at a random position among the 4 options each time. Each question must have exactly 4 answer options. Return ONLY a valid JSON array with no extra text:
[{"q":"question text","options":["Option A","Option B","Option C","Option D"],"correct":2,"explanation":"brief explanation of the correct answer"}]

The "correct" field is the 0-based index of the correct option in the options array.

Material:
${context}`
      }]
    })

    const text = msg.content[0].text
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return res.json({ questions: [] })
    const questions = JSON.parse(match[0])

    questions.forEach(q => {
      const correct = q.options[q.correct]
      for (let i = q.options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [q.options[i], q.options[j]] = [q.options[j], q.options[i]]
      }
      q.correct = q.options.indexOf(correct)
    })

    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]]
    }

    res.json({ questions })
  } catch {
    res.json({ questions: [] })
  }
}

module.exports = { handleQuiz }
