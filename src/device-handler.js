const { createClient } = require('@supabase/supabase-js')

const DEVICE_LIMIT = 3

function makeDeviceHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  async function register(req, res) {
    const { deviceId, label } = req.body || {}
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' })
    const userId = req.user.id

    const { data: existing } = await db
      .from('user_devices')
      .select('id')
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .maybeSingle()

    if (existing) {
      await db.from('user_devices')
        .update({ last_seen: new Date().toISOString(), label })
        .eq('id', existing.id)
      return res.json({ ok: true })
    }

    const { count } = await db
      .from('user_devices')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)

    if (count >= DEVICE_LIMIT) {
      return res.status(403).json({ error: 'device_limit', limit: DEVICE_LIMIT })
    }

    const { error } = await db.from('user_devices').insert({
      user_id: userId,
      device_id: deviceId,
      label,
      last_seen: new Date().toISOString()
    })
    if (error) return res.status(500).json({ error: 'Failed to register device.' })
    res.json({ ok: true })
  }

  async function list(req, res) {
    const { data, error } = await db
      .from('user_devices')
      .select('device_id, label, last_seen, created_at')
      .eq('user_id', req.user.id)
      .order('last_seen', { ascending: false })
    if (error) return res.status(500).json({ error: 'Failed.' })
    res.json(data || [])
  }

  async function remove(req, res) {
    const { deviceId } = req.params
    const { error } = await db
      .from('user_devices')
      .delete()
      .eq('user_id', req.user.id)
      .eq('device_id', deviceId)
    if (error) return res.status(500).json({ error: 'Failed.' })
    res.json({ ok: true })
  }

  return { register, list, remove }
}

module.exports = { makeDeviceHandler, DEVICE_LIMIT }
