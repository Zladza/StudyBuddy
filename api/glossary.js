const { makeAuthMiddleware } = require('../src/auth-middleware')
const { handleGlossary } = require('../src/glossary-handler')

const requireAuth = makeAuthMiddleware()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  return handleGlossary(req, res)
}
