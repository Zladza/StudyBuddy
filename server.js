require('dotenv').config()
const express = require('express')
const path = require('path')

const app = express()

// Webhook MUST come before express.json() — needs raw body for signature verification
const { makeSubscriptionHandler } = require('./src/subscription-handler')
const subscription = makeSubscriptionHandler()
app.post('/api/webhooks/lemonsqueezy',
  express.raw({ type: 'application/json' }),
  (req, res) => subscription.handleWebhook(req, res)
)

app.use(express.json({ limit: '30mb' }))
app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  })
})

const { makeAuthMiddleware } = require('./src/auth-middleware')
const { makeHistoryHandler } = require('./src/history-handler')
const { handleChat: handleClaude } = require('./src/chat-handler')
const { handleChat: handleOpenAI } = require('./src/openai-chat-handler')
const { handleChat: handleGemini } = require('./src/gemini-chat-handler')
const { makePlanGuard } = require('./src/plan-guard')

const requireAuth = makeAuthMiddleware()
const history = makeHistoryHandler()
const { requirePro, limitFree, getPlan, getUsageToday } = makePlanGuard()

app.get('/api/history', requireAuth, (req, res) => history.listConversations(req, res))
app.post('/api/history', requireAuth, (req, res) => history.saveExchange(req, res))
app.get('/api/history/:id', requireAuth, (req, res) => history.getConversation(req, res))
app.delete('/api/history/:id', requireAuth, (req, res) => history.deleteConversation(req, res))
app.patch('/api/history/:id', requireAuth, (req, res) => history.updateConversationTitle(req, res))
app.put('/api/history/:id/messages', requireAuth, (req, res) => history.replaceMessages(req, res))

const { handleFollowup } = require('./src/followup-handler')
const { handleFlashcards } = require('./src/flashcard-handler')
const { handleQuiz } = require('./src/quiz-handler')
const { handleGlossary } = require('./src/glossary-handler')
const { handleSummary } = require('./src/summary-handler')
const { handleTitle } = require('./src/title-handler')

app.post('/api/followup',   requireAuth, requirePro, (req, res) => handleFollowup(req, res))
app.post('/api/flashcards', requireAuth, requirePro, (req, res) => handleFlashcards(req, res))
app.post('/api/quiz',       requireAuth, requirePro, (req, res) => handleQuiz(req, res))
app.post('/api/glossary',   requireAuth, requirePro, (req, res) => handleGlossary(req, res))
app.post('/api/summary',    requireAuth, requirePro, (req, res) => handleSummary(req, res))
app.post('/api/title',      requireAuth, (req, res) => handleTitle(req, res))

app.post('/api/chat', requireAuth, limitFree('messages'), (req, res) => {
  const provider = req.body?.provider || 'openai'
  if (provider === 'openai') return handleOpenAI(req, res)
  if (provider === 'gemini') return handleGemini(req, res)
  return handleClaude(req, res)
})

app.get('/api/subscription', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const plan = await getPlan(req.user.id, req.user.email)
  const usage = await getUsageToday(req.user.id)
  res.json({
    plan,
    messagesToday: usage.messagesToday,
    uploadsToday: usage.uploadsToday,
    lsBuyUrl: process.env.LEMONSQUEEZY_BUY_URL || ''
  })
})

const { makeShareHandler } = require('./src/share-handler')
const { makeGroupsHandler } = require('./src/groups-handler')
const share = makeShareHandler()
const groups = makeGroupsHandler()

app.post('/api/conversations/:id/share',  requireAuth, (req, res) => share.shareConversation(req, res))
app.delete('/api/conversations/:id/share',requireAuth, (req, res) => share.unshareConversation(req, res))
app.get('/api/share/:token',              requireAuth, (req, res) => share.getShared(req, res))
app.post('/api/share/:token/fork',        requireAuth, (req, res) => share.forkConversation(req, res))

app.post('/api/groups',             requireAuth, requirePro, (req, res) => groups.createGroup(req, res))
app.get('/api/groups',              requireAuth, requirePro, (req, res) => groups.listGroups(req, res))
app.get('/api/groups/:id',          requireAuth, requirePro, (req, res) => groups.getGroup(req, res))
app.patch('/api/groups/:id',        requireAuth, requirePro, (req, res) => groups.updateGroup(req, res))
app.post('/api/groups/:id/invite',  requireAuth, requirePro, (req, res) => groups.inviteMember(req, res))
app.get('/api/groups/:id/messages', requireAuth, requirePro, (req, res) => groups.getMessages(req, res))
app.post('/api/groups/:id/messages',requireAuth, requirePro, (req, res) => groups.sendMessage(req, res))
app.delete('/api/groups/:id/leave', requireAuth, requirePro, (req, res) => groups.leaveGroup(req, res))
app.delete('/api/groups/:id',       requireAuth, requirePro, (req, res) => groups.deleteGroup(req, res))

const { makeNotesHandler } = require('./src/notes-handler')
const notesHandler = makeNotesHandler()
app.get('/api/notes',    requireAuth, requirePro, (req, res) => notesHandler.listNotes(req, res))
app.post('/api/notes',   requireAuth, requirePro, (req, res) => notesHandler.createNote(req, res))
app.patch('/api/notes/:id',  requireAuth, requirePro, (req, res) => notesHandler.updateNote(req, res))
app.delete('/api/notes/:id', requireAuth, requirePro, (req, res) => notesHandler.deleteNote(req, res))

const { makeFilesHandler } = require('./src/files-handler')
const { makeConvFilesHandler } = require('./src/conversation-files-handler')
const filesHandler = makeFilesHandler()
const convFilesHandler = makeConvFilesHandler()

app.get('/api/files',    requireAuth, requirePro, (req, res) => filesHandler.listFiles(req, res))
app.post('/api/files',   requireAuth, requirePro, (req, res) => filesHandler.uploadFile(req, res))
app.delete('/api/files/:id',    requireAuth, requirePro, (req, res) => filesHandler.deleteFile(req, res))
app.get('/api/files/:id/url',   requireAuth, requirePro, (req, res) => filesHandler.getSignedUrl(req, res))
app.get('/api/conversations/:id/files',  requireAuth, (req, res) => convFilesHandler.listConvFiles(req, res))
app.post('/api/conversations/:id/files', requireAuth, (req, res) => convFilesHandler.linkFile(req, res))

const { makeDeviceHandler } = require('./src/device-handler')
const deviceHandler = makeDeviceHandler()
app.post('/api/devices',            requireAuth, (req, res) => deviceHandler.register(req, res))
app.get('/api/devices',             requireAuth, (req, res) => deviceHandler.list(req, res))
app.delete('/api/devices/:deviceId',requireAuth, (req, res) => deviceHandler.remove(req, res))

const { makeAdminHandler } = require('./src/admin-handler')
const admin = makeAdminHandler()
app.get('/api/admin/users', requireAuth, admin.requireAdmin, (req, res) => admin.listUsers(req, res))

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

if (require.main === module) {
  const port = process.env.PORT || 3000
  app.listen(port, () => console.log(`StudyBuddy running at http://localhost:${port}`))
}

module.exports = app
