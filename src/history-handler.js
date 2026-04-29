const { createClient } = require('@supabase/supabase-js')

function makeHistoryHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  async function listConversations(req, res) {
    const { data, error } = await db
      .from('conversations')
      .select('id, title, language, updated_at')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('listConversations error:', error)
      return res.status(500).json({ error: 'Greška pri učitavanju istorije.' })
    }
    res.json(data)
  }

  async function getConversation(req, res) {
    const { id } = req.params

    const { data: conv, error: convError } = await db
      .from('conversations')
      .select('id, title, language')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single()

    if (convError || !conv) {
      return res.status(404).json({ error: 'Razgovor nije pronađen.' })
    }

    const { data: messages, error } = await db
      .from('messages')
      .select('id, role, content, has_pdf, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('getConversation messages error:', error)
      return res.status(500).json({ error: 'Greška pri učitavanju poruka.' })
    }
    res.json({ conversation: conv, messages })
  }

  async function saveExchange(req, res) {
    const { conversationId, language, messages, title } = req.body

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Poruke moraju biti neprazan niz.' })
    }

    let convId = conversationId

    if (!convId) {
      const autoTitle = (title && title.trim()) ? title.trim() : (messages[0]?.content?.slice(0, 50) || 'Novi razgovor')
      const { data, error } = await db
        .from('conversations')
        .insert({ user_id: req.user.id, title: autoTitle, language: language || 'sr' })
        .select('id')
        .single()

      if (error) {
        console.error('saveExchange create conv error:', error)
        return res.status(500).json({ error: 'Greška pri čuvanju razgovora.' })
      }
      convId = data.id
    } else {
      // Verify ownership and update timestamp
      const { data: ownedConv, error: ownerError } = await db
        .from('conversations')
        .select('id')
        .eq('id', convId)
        .eq('user_id', req.user.id)
        .single()

      if (ownerError || !ownedConv) {
        return res.status(404).json({ error: 'Razgovor nije pronađen.' })
      }

      const { error: updateError } = await db
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', convId)
        .eq('user_id', req.user.id)

      if (updateError) {
        console.error('saveExchange update conv error:', updateError)
        return res.status(500).json({ error: 'Greška pri čuvanju razgovora.' })
      }
    }

    const rows = messages.map(m => ({
      conversation_id: convId,
      role: m.role,
      content: m.content,
      has_pdf: m.has_pdf || false
    }))

    const { error: msgError } = await db.from('messages').insert(rows)
    if (msgError) {
      console.error('saveExchange insert messages error:', msgError)
      return res.status(500).json({ error: 'Greška pri čuvanju poruka.' })
    }

    res.json({ conversationId: convId })
  }

  async function deleteConversation(req, res) {
    const { id } = req.params
    const { error } = await db
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)

    if (error) {
      console.error('deleteConversation error:', error)
      return res.status(500).json({ error: 'Greška pri brisanju razgovora.' })
    }
    res.json({ success: true })
  }

  async function updateConversationTitle(req, res) {
    const { id } = req.params
    const { title } = req.body

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Naslov ne može biti prazan.' })
    }

    const { error } = await db
      .from('conversations')
      .update({ title: title.trim() })
      .eq('id', id)
      .eq('user_id', req.user.id)

    if (error) {
      console.error('updateConversationTitle error:', error)
      return res.status(500).json({ error: 'Greška pri ažuriranju naslova.' })
    }
    res.json({ success: true })
  }

  async function replaceMessages(req, res) {
    const { id } = req.params
    const { messages } = req.body

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages must be an array.' })
    }

    const { data: conv, error: ownerError } = await db
      .from('conversations').select('id').eq('id', id).eq('user_id', req.user.id).single()

    if (ownerError || !conv) return res.status(404).json({ error: 'Not found.' })

    await db.from('messages').delete().eq('conversation_id', id)

    if (messages.length > 0) {
      const rows = messages.map(m => ({
        conversation_id: id,
        role: m.role,
        content: m.content,
        has_pdf: m.has_pdf || false
      }))
      const { error } = await db.from('messages').insert(rows)
      if (error) {
        console.error('replaceMessages error:', error)
        return res.status(500).json({ error: 'Greška pri čuvanju poruka.' })
      }
    }

    await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', id)
    res.json({ success: true })
  }

  return { listConversations, getConversation, saveExchange, deleteConversation, updateConversationTitle, replaceMessages }
}

module.exports = { makeHistoryHandler }
