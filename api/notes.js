const { makeAuthMiddleware } = require('../src/auth-middleware')
const { makeNotesHandler } = require('../src/notes-handler')

const requireAuth = makeAuthMiddleware()
const notes = makeNotesHandler()

function applyMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

module.exports = async (req, res) => {
  try { await applyMiddleware(requireAuth, req, res) } catch { return }
  if (req.method === 'GET') return notes.listNotes(req, res)
  if (req.method === 'POST') return notes.createNote(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
