const { makeAuthMiddleware } = require('../src/auth-middleware')
const { handleChat: handleClaude } = require('../src/chat-handler')
const { handleChat: handleOpenAI } = require('../src/openai-chat-handler')

const requireAuth = makeAuthMiddleware()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    await applyMiddleware(requireAuth, req, res)
  } catch {
    return
  }
  const provider = req.body?.provider || 'claude'
  return provider === 'openai' ? handleOpenAI(req, res) : handleClaude(req, res)
}
