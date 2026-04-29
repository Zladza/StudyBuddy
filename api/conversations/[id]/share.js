const { makeAuthMiddleware } = require('../../../src/auth-middleware')
const { makeShareHandler } = require('../../../src/share-handler')

const requireAuth = makeAuthMiddleware()
const share = makeShareHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  req.params = { id: req.query.id }
  if (req.method === 'POST') return share.shareConversation(req, res)
  if (req.method === 'DELETE') return share.unshareConversation(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
