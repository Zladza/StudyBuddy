const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

function makeShareHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  async function shareConversation(req, res) {
    const { id } = req.params
    const { data: conv, error } = await db
      .from('conversations').select('id, share_token').eq('id', id).eq('user_id', req.user.id).single()
    if (error || !conv) return res.status(404).json({ error: 'Not found.' })
    if (conv.share_token) return res.json({ token: conv.share_token })
    const token = crypto.randomUUID()
    const { error: upErr } = await db.from('conversations').update({ share_token: token }).eq('id', id)
    if (upErr) return res.status(500).json({ error: 'Failed.' })
    res.json({ token })
  }

  async function unshareConversation(req, res) {
    const { id } = req.params
    const { error } = await db.from('conversations').update({ share_token: null }).eq('id', id).eq('user_id', req.user.id)
    if (error) return res.status(500).json({ error: 'Failed.' })
    res.json({ success: true })
  }

  async function getShared(req, res) {
    const { token } = req.params
    const { data: conv, error } = await db
      .from('conversations').select('id, title, language').eq('share_token', token).single()
    if (error || !conv) return res.status(404).json({ error: 'Not found.' })
    const { data: messages } = await db
      .from('messages').select('role, content, has_pdf, created_at')
      .eq('conversation_id', conv.id).order('created_at', { ascending: true })
    res.json({ conversation: conv, messages: messages || [] })
  }

  async function forkConversation(req, res) {
    const { token } = req.params
    const { data: conv, error } = await db
      .from('conversations').select('id, title, language').eq('share_token', token).single()
    if (error || !conv) return res.status(404).json({ error: 'Not found.' })
    const { data: messages } = await db
      .from('messages').select('role, content, has_pdf').eq('conversation_id', conv.id).order('created_at', { ascending: true })
    const { data: newConv, error: convErr } = await db
      .from('conversations').insert({ user_id: req.user.id, title: conv.title, language: conv.language || 'sr' })
      .select('id').single()
    if (convErr) return res.status(500).json({ error: 'Failed to fork.' })
    const rows = (messages || [])
      .filter(m => !String(m.content).startsWith('{"__tool__":'))
      .map(m => ({ conversation_id: newConv.id, role: m.role, content: m.content, has_pdf: m.has_pdf || false }))
    if (rows.length > 0) await db.from('messages').insert(rows)
    res.json({ conversationId: newConv.id })
  }

  return { shareConversation, unshareConversation, getShared, forkConversation }
}

module.exports = { makeShareHandler }
