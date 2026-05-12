const jwt = require('jsonwebtoken')

function makeAuthMiddleware() {
  const secret = process.env.SUPABASE_JWT_SECRET

  return (req, res, next) => {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const token = auth.slice(7)
    try {
      const payload = jwt.verify(token, secret)
      req.user = {
        id: payload.sub,
        email: payload.email,
        user_metadata: payload.user_metadata || {}
      }
      req.token = token
      next()
    } catch {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
}

module.exports = { makeAuthMiddleware }
