const { createClient } = require('@supabase/supabase-js')

function makeFilesHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  async function uploadFile(req, res) {
    const { name, mime_type, size, base64 } = req.body
    if (!name || !mime_type || size == null || !base64) {
      return res.status(400).json({ error: 'name, mime_type, size, base64 required.' })
    }
    const maxSize = mime_type === 'application/pdf' ? 20 * 1024 * 1024 : 5 * 1024 * 1024
    if (size > maxSize) {
      return res.status(400).json({ error: 'File too large.' })
    }

    const { data: fileRow, error: insertError } = await db
      .from('files')
      .insert({ user_id: req.user.id, name, size, mime_type, storage_path: 'pending' })
      .select('id')
      .single()

    if (insertError) {
      console.error('uploadFile insert error:', insertError)
      return res.status(500).json({ error: insertError.message || 'Greška pri čuvanju fajla.' })
    }

    const fileId = fileRow.id
    const safeName = name.replace(/[/\\]/g, '_')
    const storagePath = `${req.user.id}/${fileId}-${safeName}`
    const buffer = Buffer.from(base64, 'base64')

    const { error: storageError } = await db.storage
      .from('study-files')
      .upload(storagePath, buffer, { contentType: mime_type })

    if (storageError) {
      console.error('uploadFile storage error:', storageError)
      const { error: rollbackError } = await db.from('files').delete().eq('id', fileId)
      if (rollbackError) console.error('uploadFile rollback error:', rollbackError)
      return res.status(500).json({ error: storageError.message || 'Greška pri uploadovanju fajla.' })
    }

    const { error: updateError } = await db.from('files').update({ storage_path: storagePath }).eq('id', fileId)
    if (updateError) console.error('uploadFile update error:', updateError)

    const { data: urlData } = await db.storage
      .from('study-files')
      .createSignedUrl(storagePath, 3600)

    res.json({ id: fileId, name, mime_type, size, signedUrl: urlData?.signedUrl || null })
  }

  async function listFiles(req, res) {
    const { data, error } = await db
      .from('files')
      .select('id, name, size, mime_type, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('listFiles error:', error)
      return res.status(500).json({ error: 'Greška pri učitavanju fajlova.' })
    }
    res.json(data || [])
  }

  async function deleteFile(req, res) {
    const { id } = req.params
    const { data: file, error: fetchError } = await db
      .from('files')
      .select('storage_path')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single()

    if (fetchError || !file) return res.status(404).json({ error: 'Fajl nije pronađen.' })

    const { error: removeError } = await db.storage.from('study-files').remove([file.storage_path])
    if (removeError) console.error('deleteFile storage remove error:', removeError)

    const { error } = await db
      .from('files')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)

    if (error) {
      console.error('deleteFile error:', error)
      return res.status(500).json({ error: 'Greška pri brisanju fajla.' })
    }
    res.json({ success: true })
  }

  async function getSignedUrl(req, res) {
    const { id } = req.params
    const { data: file, error } = await db
      .from('files')
      .select('storage_path')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single()

    if (error || !file) return res.status(404).json({ error: 'Fajl nije pronađen.' })

    const { data: urlData, error: urlError } = await db.storage
      .from('study-files')
      .createSignedUrl(file.storage_path, 3600)

    if (urlError || !urlData) {
      return res.status(500).json({ error: 'Greška pri generisanju URL-a.' })
    }
    res.json({ signedUrl: urlData.signedUrl })
  }

  return { uploadFile, listFiles, deleteFile, getSignedUrl }
}

module.exports = { makeFilesHandler }
