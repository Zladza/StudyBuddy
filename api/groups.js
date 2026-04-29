const { makeAuthMiddleware } = require('../src/auth-middleware')
const { makeGroupsHandler } = require('../src/groups-handler')

const requireAuth = makeAuthMiddleware()
const groups = makeGroupsHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  if (req.method === 'GET') return groups.listGroups(req, res)
  if (req.method === 'POST') return groups.createGroup(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
