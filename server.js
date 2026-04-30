require('dotenv').config()
const express = require('express')
const path = require('path')

const app = express()

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
const { handleChat } = require('./src/chat-handler')

const requireAuth = makeAuthMiddleware()
const history = makeHistoryHandler()

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
app.post('/api/followup', requireAuth, (req, res) => handleFollowup(req, res))
app.post('/api/flashcards', requireAuth, (req, res) => handleFlashcards(req, res))
app.post('/api/quiz', requireAuth, (req, res) => handleQuiz(req, res))
app.post('/api/glossary', requireAuth, (req, res) => handleGlossary(req, res))
app.post('/api/summary', requireAuth, (req, res) => handleSummary(req, res))
app.post('/api/title', requireAuth, (req, res) => handleTitle(req, res))

app.post('/api/chat', requireAuth, (req, res) => handleChat(req, res))

const { makeShareHandler } = require('./src/share-handler')
const { makeGroupsHandler } = require('./src/groups-handler')
const share = makeShareHandler()
const groups = makeGroupsHandler()

app.post('/api/conversations/:id/share', requireAuth, (req, res) => share.shareConversation(req, res))
app.delete('/api/conversations/:id/share', requireAuth, (req, res) => share.unshareConversation(req, res))
app.get('/api/share/:token', requireAuth, (req, res) => share.getShared(req, res))
app.post('/api/share/:token/fork', requireAuth, (req, res) => share.forkConversation(req, res))

app.post('/api/groups', requireAuth, (req, res) => groups.createGroup(req, res))
app.get('/api/groups', requireAuth, (req, res) => groups.listGroups(req, res))
app.get('/api/groups/:id', requireAuth, (req, res) => groups.getGroup(req, res))
app.post('/api/groups/:id/invite', requireAuth, (req, res) => groups.inviteMember(req, res))
app.get('/api/groups/:id/messages', requireAuth, (req, res) => groups.getMessages(req, res))
app.post('/api/groups/:id/messages', requireAuth, (req, res) => groups.sendMessage(req, res))
app.delete('/api/groups/:id/leave', requireAuth, (req, res) => groups.leaveGroup(req, res))
app.delete('/api/groups/:id', requireAuth, (req, res) => groups.deleteGroup(req, res))

const { makeNotesHandler } = require('./src/notes-handler')
const notesHandler = makeNotesHandler()
app.get('/api/notes', requireAuth, (req, res) => notesHandler.listNotes(req, res))
app.post('/api/notes', requireAuth, (req, res) => notesHandler.createNote(req, res))
app.patch('/api/notes/:id', requireAuth, (req, res) => notesHandler.updateNote(req, res))
app.delete('/api/notes/:id', requireAuth, (req, res) => notesHandler.deleteNote(req, res))
// 404 fallback for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

if (require.main === module) {
  const port = process.env.PORT || 3000
  app.listen(port, () => console.log(`StudyBuddy running at http://localhost:${port}`))
}

module.exports = app
