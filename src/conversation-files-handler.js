const { createClient } = require('@supabase/supabase-js')

function makeConvFilesHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  async function linkFile(req, res) {
    const { id: conversationId } = req.params
    const { fileId } = req.body

    if (!fileId) return res.status(400).json({ error: 'fileId required.' })

    const { data: conv, error: convError } = await db
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', req.user.id)
      .single()

    if (convError || !conv) return res.status(404).json({ error: 'Razgovor nije pronađen.' })

    const { data: file, error: fileError } = await db
      .from('files')
      .select('id')
      .eq('id', fileId)
      .eq('user_id', req.user.id)
      .single()

    if (fileError || !file) return res.status(404).json({ error: 'Fajl nije pronađen.' })

    const { error } = await db
      .from('conversation_files')
      .upsert({ conversation_id: conversationId, file_id: fileId }, { onConflict: 'conversation_id,file_id' })

    if (error) {
      console.error('linkFile error:', error)
      return res.status(500).json({ error: 'Greška pri povezivanju fajla.' })
    }
    res.json({ success: true })
  }

  async function listConvFiles(req, res) {
    const { id: conversationId } = req.params

    const { data: conv, error: convError } = await db
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', req.user.id)
      .single()

    if (convError || !conv) return res.status(404).json({ error: 'Razgovor nije pronađen.' })

    const { data, error } = await db
      .from('conversation_files')
      .select('file_id, files(id, name, size, mime_type, storage_path)')
      .eq('conversation_id', conversationId)

    if (error) {
      console.error('listConvFiles error:', error)
      return res.status(500).json({ error: 'Greška pri učitavanju fajlova.' })
    }

    const files = await Promise.all((data || []).map(async row => {
      const f = row.files
      if (!f) return null
      const { data: urlData } = await db.storage
        .from('study-files')
        .createSignedUrl(f.storage_path, 3600)
      return { id: f.id, name: f.name, size: f.size, mime_type: f.mime_type, signedUrl: urlData?.signedUrl || null }
    }))

    res.json(files.filter(Boolean))
  }

  return { linkFile, listConvFiles }
}

module.exports = { makeConvFilesHandler }
