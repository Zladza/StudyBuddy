const { createClient } = require('@supabase/supabase-js')

function makeNotesHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  async function listNotes(req, res) {
    const { data, error } = await db
      .from('notes')
      .select('id, title, content, updated_at')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false })
    if (error) return res.status(500).json({ error: 'Failed.' })
    res.json(data || [])
  }

  async function createNote(req, res) {
    const { title = '', content = '' } = req.body || {}
    const { data, error } = await db
      .from('notes')
      .insert({ user_id: req.user.id, title, content })
      .select('id, title, content, updated_at')
      .single()
    if (error) return res.status(500).json({ error: 'Failed.' })
    res.json(data)
  }

  async function updateNote(req, res) {
    const { id } = req.params
    const { title, content } = req.body || {}
    const updates = { updated_at: new Date().toISOString() }
    if (title !== undefined) updates.title = title
    if (content !== undefined) updates.content = content
    const { data, error } = await db
      .from('notes')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('id, title, content, updated_at')
      .single()
    if (error) return res.status(500).json({ error: 'Failed.' })
    res.json(data)
  }

  async function deleteNote(req, res) {
    const { id } = req.params
    const { error } = await db
      .from('notes')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)
    if (error) return res.status(500).json({ error: 'Failed.' })
    res.json({ success: true })
  }

  return { listNotes, createNote, updateNote, deleteNote }
}

module.exports = { makeNotesHandler }
