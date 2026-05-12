const { createClient } = require('@supabase/supabase-js')

const LIMITS = { messages: 10, uploads: 1 }

function isVip(email) {
  if (!email || !process.env.VIP_EMAILS) return false
  const list = process.env.VIP_EMAILS.split(',').map(e => e.trim().toLowerCase())
  const result = list.includes(email.toLowerCase())
  console.log('[VIP check]', email, '→', result, '| list:', list)
  return result
}

function makePlanGuard(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  async function getPlan(userId, email) {
    if (isVip(email)) return 'pro'
    const { data } = await db
      .from('profiles')
      .select('plan')
      .eq('id', userId)
      .single()
    return data?.plan || 'free'
  }

  async function getUsageToday(userId) {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await db
      .from('usage_daily')
      .select('messages_count, uploads_count')
      .eq('user_id', userId)
      .eq('date', today)
      .single()
    return {
      messagesToday: data?.messages_count || 0,
      uploadsToday: data?.uploads_count || 0
    }
  }

  async function requirePro(req, res, next) {
    const plan = await getPlan(req.user.id, req.user.email)
    if (plan !== 'pro') return res.status(403).json({ error: 'pro_required' })
    next()
  }

  function limitFree(type) {
    return async (req, res, next) => {
      const plan = await getPlan(req.user.id, req.user.email)
      if (plan === 'pro') return next()
      const { data, error } = await db.rpc('increment_and_check_usage', {
        p_user_id: req.user.id,
        p_type: type,
        p_limit: LIMITS[type]
      })
      if (error || !data?.allowed) {
        return res.status(403).json({ error: 'limit_reached' })
      }
      next()
    }
  }

  return { requirePro, limitFree, getPlan, getUsageToday }
}

module.exports = { makePlanGuard, isVip }
