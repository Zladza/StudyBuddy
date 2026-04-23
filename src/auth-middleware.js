const { createClient } = require('@supabase/supabase-js')

function makeAuthMiddleware(supabaseClient) {
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
