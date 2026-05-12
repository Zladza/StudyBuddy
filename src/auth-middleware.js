const jwt = require('jsonwebtoken')
const { createClient } = require('@supabase/supabase-js')

function makeAuthMiddleware(supabaseClient) {
  const secret = process.env.SUPABASE_JWT_SECRET
  const client = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  return async (req, res, next) => {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const token = auth.slice(7)

    // Try local JWT verification first (fast, no network)
    if (secret) {
      try {
        const payload = jwt.verify(token, secret)
        req.user = {
          id: payload.sub,
          email: payload.email,
          user_metadata: payload.user_metadata || {}
        }
        req.token = token
        return next()
      } catch {
        // Fall through to Supabase API
      }
    }

    // Fallback: verify via Supabase API
    const { data, error } = await client.auth.getUser(token)
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    req.user = data.user
    req.token = token
    next()
  }
}

module.exports = { makeAuthMiddleware }
