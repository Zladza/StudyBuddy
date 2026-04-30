const { makeAuthMiddleware } = require('../../src/auth-middleware')
const { makeFilesHandler } = require('../../src/files-handler')

const requireAuth = makeAuthMiddleware()
const files = makeFilesHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  req.params = { id: req.query.id }
  if (req.method === 'DELETE') return files.deleteFile(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
