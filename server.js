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

// Auth, history, and chat routes are mounted in later tasks.
// 404 fallback for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

if (require.main === module) {
  const port = process.env.PORT || 3000
  app.listen(port, () => console.log(`StudyBuddy running at http://localhost:${port}`))
}

module.exports = app
