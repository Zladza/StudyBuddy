const { makeAuthMiddleware } = require('../../../src/auth-middleware')
const { makeHistoryHandler } = require('../../../src/history-handler')

const requireAuth = makeAuthMiddleware()
const history = makeHistoryHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  req.params = { id: req.query.id }
  if (req.method === 'PUT') return history.replaceMessages(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
