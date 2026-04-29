const { makeAuthMiddleware } = require('../../../src/auth-middleware')
const { makeGroupsHandler } = require('../../../src/groups-handler')

const requireAuth = makeAuthMiddleware()
const groups = makeGroupsHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  req.params = { id: req.query.id }
  return groups.inviteMember(req, res)
}
