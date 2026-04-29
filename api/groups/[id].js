const { makeAuthMiddleware } = require('../../src/auth-middleware')
const { makeGroupsHandler } = require('../../src/groups-handler')

const requireAuth = makeAuthMiddleware()
const groups = makeGroupsHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  req.params = { id: req.query.id }
  if (req.method === 'GET') return groups.getGroup(req, res)
  if (req.method === 'DELETE') return groups.deleteGroup(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
