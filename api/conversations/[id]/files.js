const { makeAuthMiddleware } = require('../../../src/auth-middleware')
const { makeConvFilesHandler } = require('../../../src/conversation-files-handler')

const requireAuth = makeAuthMiddleware()
const convFiles = makeConvFilesHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  req.params = { id: req.query.id }
  if (req.method === 'GET') return convFiles.listConvFiles(req, res)
  if (req.method === 'POST') return convFiles.linkFile(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
