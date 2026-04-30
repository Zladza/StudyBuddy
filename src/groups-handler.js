const { createClient } = require('@supabase/supabase-js')
const Anthropic = require('@anthropic-ai/sdk')

function makeGroupsHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  async function isMember(groupId, userId) {
    const { data } = await db.from('group_members').select('id').eq('group_id', groupId).eq('user_id', userId).single()
    return !!data
  }

  async function createGroup(req, res) {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Name required.' })
    const { data: group, error } = await db
      .from('study_groups').insert({ name: name.trim(), created_by: req.user.id })
      .select('id, name, created_by, created_at').single()
    if (error) return res.status(500).json({ error: 'Failed.' })
    await db.from('group_members').insert({ group_id: group.id, user_id: req.user.id })
    res.json(group)
  }

  async function listGroups(req, res) {
    const { data: rows } = await db.from('group_members').select('group_id').eq('user_id', req.user.id)
    if (!rows || rows.length === 0) return res.json([])
    const ids = rows.map(r => r.group_id)
    const { data: groups } = await db.from('study_groups').select('id, name, created_by, created_at').in('id', ids).order('created_at', { ascending: false })
    res.json(groups || [])
  }

  async function getGroup(req, res) {
    const { id } = req.params
    if (!(await isMember(id, req.user.id))) return res.status(403).json({ error: 'Not a member.' })
    const { data: group } = await db.from('study_groups').select('id, name, created_by, created_at').eq('id', id).single()
    if (!group) return res.status(404).json({ error: 'Not found.' })
    const { data: memberRows } = await db.from('group_members').select('user_id, joined_at').eq('group_id', id)
    const members = await Promise.all((memberRows || []).map(async m => {
      const { data: { user: u } } = await db.auth.admin.getUserById(m.user_id)
      return { user_id: m.user_id, email: u?.email, display_name: u?.user_metadata?.display_name, joined_at: m.joined_at }
    }))
    res.json({ ...group, members })
  }

  async function inviteMember(req, res) {
    const { id } = req.params
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'Email required.' })
    if (!(await isMember(id, req.user.id))) return res.status(403).json({ error: 'Not a member.' })
    const { data: { user: target }, error: listErr } = await db.auth.admin.getUserByEmail(email.trim())
    if (listErr || !target) return res.status(404).json({ error: 'user_not_found' })
    if (await isMember(id, target.id)) return res.status(409).json({ error: 'already_member' })
    const { error } = await db.from('group_members').insert({ group_id: id, user_id: target.id })
    if (error) return res.status(500).json({ error: 'Failed.' })
    res.json({ success: true, user: { email: target.email, display_name: target.user_metadata?.display_name } })
  }

  async function getMessages(req, res) {
    const { id } = req.params
    if (!(await isMember(id, req.user.id))) return res.status(403).json({ error: 'Not a member.' })
    const { data: messages } = await db
      .from('group_messages').select('id, user_id, content, is_ai, display_name, created_at')
      .eq('group_id', id).order('created_at', { ascending: true }).limit(200)
    res.json(messages || [])
  }

  async function sendMessage(req, res) {
    const { id } = req.params
    const { content, displayName } = req.body
    if (!content?.trim()) return res.status(400).json({ error: 'Content required.' })
    if (!(await isMember(id, req.user.id))) return res.status(403).json({ error: 'Not a member.' })

    const { data: msg } = await db
      .from('group_messages').insert({ group_id: id, user_id: req.user.id, content: content.trim(), display_name: displayName || null })
      .select().single()

    if (/\@ai\b/i.test(content)) {
      const { data: recent } = await db
        .from('group_messages').select('content, is_ai, display_name').eq('group_id', id)
        .order('created_at', { ascending: false }).limit(12)
      const ctx = (recent || []).reverse().map(m => `${m.is_ai ? 'StudyBuddy' : (m.display_name || 'Student')}: ${m.content}`).join('\n')
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      try {
        const aiRes = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system: 'You are StudyBuddy, a helpful AI study assistant in a group chat with students. Be concise and educational.',
          messages: [{ role: 'user', content: `Group chat:\n${ctx}\n\nA student tagged @AI. Respond helpfully.` }]
        })
        await db.from('group_messages').insert({ group_id: id, user_id: null, content: aiRes.content[0].text, is_ai: true, display_name: 'StudyBuddy' })
      } catch {}
    }

    res.json({ success: true, message: msg })
  }

  async function leaveGroup(req, res) {
    const { id } = req.params
    await db.from('group_members').delete().eq('group_id', id).eq('user_id', req.user.id)
    res.json({ success: true })
  }

  async function deleteGroup(req, res) {
    const { id } = req.params
    const { data: group } = await db.from('study_groups').select('created_by').eq('id', id).single()
    if (!group || group.created_by !== req.user.id) return res.status(403).json({ error: 'Not authorized.' })
    await db.from('study_groups').delete().eq('id', id)
    res.json({ success: true })
  }

  return { createGroup, listGroups, getGroup, inviteMember, getMessages, sendMessage, leaveGroup, deleteGroup }
}

module.exports = { makeGroupsHandler }
