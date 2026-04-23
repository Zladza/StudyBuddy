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

app.post('/api/chat', requireAuth, (req, res) => handleChat(req, res))
// 404 fallback for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

if (require.main === module) {
  const port = process.env.PORT || 3000
  app.listen(port, () => console.log(`StudyBuddy running at http://localhost:${port}`))
}

module.exports = app
