const { createClient } = require('@supabase/supabase-js')
const { isVip } = require('./plan-guard')

function makeAdminHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  function requireAdmin(req, res, next) {
    if (!isVip(req.user?.email)) return res.status(403).json({ error: 'forbidden' })
    next()
  }

  async function listUsers(req, res) {
    try {
      const today = new Date().toISOString().split('T')[0]

      const [authResult, profilesResult, usageResult] = await Promise.all([
        db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        db.from('profiles').select('id, plan'),
        db.from('usage_daily').select('user_id, messages_count, uploads_count').eq('date', today)
      ])

      if (authResult.error) throw authResult.error

      const planMap = {}
      for (const p of profilesResult.data || []) planMap[p.id] = p.plan

      const usageMap = {}
      for (const u of usageResult.data || []) usageMap[u.user_id] = u

      const users = authResult.data.users.map(u => ({
        id: u.id,
        email: u.email,
        plan: isVip(u.email) ? 'vip' : (planMap[u.id] || 'free'),
        messagestoday: usageMap[u.id]?.messages_count || 0,
        uploadstoday: usageMap[u.id]?.uploads_count || 0,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at
      }))

      users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

      res.json({ users, total: users.length })
    } catch (err) {
      console.error('admin listUsers error:', err)
      res.status(500).json({ error: err.message || 'internal error' })
    }
  }

  return { requireAdmin, listUsers }
}

module.exports = { makeAdminHandler }
