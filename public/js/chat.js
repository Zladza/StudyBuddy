/* global sb, I18N, marked, getSession, requireSession, signOut, getAccessToken */

// ── State ──────────────────────────────────────────────────────────────────
let currentLang = navigator.language.startsWith('sr') ? 'sr' : 'en'
let currentConversationId = null
let currentMessages = [] // [{ role, content, hasPdf }]
let conversations = []   // sidebar list
let attachedPdf = null   // { name, base64 } | null
let isSending = false

// ── Boot ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const session = await requireSession()
  if (!session) return

  const email = session.user.email
  const username = email.split('@')[0]
  document.getElementById('user-email').textContent = email
  document.getElementById('greeting').textContent = `${I18N[currentLang].greeting}, ${username}! 👋`
  document.getElementById('greeting-subtitle').textContent = I18N[currentLang].greetingSubtitle

  applyLanguage(currentLang)
  await loadConversations()
})

// ── Language ───────────────────────────────────────────────────────────────
function setLanguage(lang) {
  currentLang = lang
  applyLanguage(lang)
}

function applyLanguage(lang) {
  const t = I18N[lang]

  // Toggle button styles
  document.getElementById('lang-sr').className = lang === 'sr'
    ? 'flex-1 py-1.5 text-xs font-semibold text-white bg-white/20 rounded-md transition'
    : 'flex-1 py-1.5 text-xs font-semibold text-white/60 transition'
  document.getElementById('lang-en').className = lang === 'en'
    ? 'flex-1 py-1.5 text-xs font-semibold text-white bg-white/20 rounded-md transition'
    : 'flex-1 py-1.5 text-xs font-semibold text-white/60 transition'

  // UI strings via data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n
    if (t[key]) el.textContent = t[key]
  })

  document.getElementById('btn-new-chat').textContent = t.newChat
  document.getElementById('disclaimer').textContent = t.disclaimer
  document.getElementById('message-input').placeholder = t.inputPlaceholder
  document.getElementById('btn-logout').textContent = t.logout
  document.getElementById('greeting').textContent =
    `${t.greeting}, ${document.getElementById('user-email').textContent.split('@')[0]}! 👋`
  document.getElementById('greeting-subtitle').textContent = t.greetingSubtitle
}

// ── Sidebar mobile ─────────────────────────────────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.remove('-translate-x-full')
  document.getElementById('mobile-overlay').classList.remove('hidden')
}

function closeSidebar() {
  document.getElementById('sidebar').classList.add('-translate-x-full')
  document.getElementById('mobile-overlay').classList.add('hidden')
}

// ── Conversations ──────────────────────────────────────────────────────────
async function loadConversations() {
  const token = getAccessToken()
  if (!token) return

  const res = await fetch('/api/history', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) return

  conversations = await res.json()
  renderConversationList()
}

function renderConversationList() {
  const section = document.getElementById('history-section')
  const list = document.getElementById('history-list')
  list.innerHTML = ''

  if (conversations.length === 0) {
    section.classList.add('hidden')
    return
  }

  section.classList.remove('hidden')
  conversations.forEach(conv => {
    const btn = document.createElement('button')
    btn.className = `flex items-center gap-2 px-2 py-1.5 rounded-lg text-white/80 hover:bg-white/10 text-xs text-left transition w-full truncate${conv.id === currentConversationId ? ' bg-white/15' : ''}`
    btn.textContent = conv.title
    btn.onclick = () => loadConversation(conv.id)
    list.appendChild(btn)
  })
}

async function loadConversation(id) {
  const token = getAccessToken()
  if (!token) return

  const res = await fetch(`/api/history/${id}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) return

  const { conversation, messages } = await res.json()
  currentConversationId = id
  currentLang = conversation.language || 'sr'
  currentMessages = messages.map(m => ({ role: m.role, content: m.content, hasPdf: m.has_pdf }))

  document.getElementById('conversation-title').textContent = conversation.title
  document.getElementById('empty-state').classList.add('hidden')

  // Remove old message bubbles (keep empty state div in DOM)
  document.querySelectorAll('.chat-bubble-row').forEach(el => el.remove())
  currentMessages.forEach(m => appendBubble(m.role, m.content))

  renderConversationList()
  closeSidebar()
  scrollToBottom()
}

// ── New chat ───────────────────────────────────────────────────────────────
function startNewChat() {
  currentConversationId = null
  currentMessages = []
  attachedPdf = null
  document.getElementById('pdf-bar').classList.add('hidden')
  document.getElementById('conversation-title').textContent = I18N[currentLang].newChat
  document.querySelectorAll('.chat-bubble-row').forEach(el => el.remove())
  document.getElementById('empty-state').classList.remove('hidden')
  document.getElementById('message-input').value = ''
  renderConversationList()
  closeSidebar()
}

// ── Quick actions ──────────────────────────────────────────────────────────
function insertTemplate(key) {
  const input = document.getElementById('message-input')
  input.value = I18N[currentLang][key]
  input.focus()
  autoResize(input)
  closeSidebar()
}

// ── PDF handling ───────────────────────────────────────────────────────────
function handlePdfSelect(event) {
  const file = event.target.files[0]
  if (!file) return

  const MAX_BYTES = 20 * 1024 * 1024
  if (file.size > MAX_BYTES) {
    showError(I18N[currentLang].fileTooLarge)
    return
  }

  const reader = new FileReader()
  reader.onload = (e) => {
    const base64 = e.target.result.split(',')[1]
    attachedPdf = { name: file.name, base64 }
    document.getElementById('pdf-name').textContent = `${I18N[currentLang].pdfAttached}: ${file.name}`
    document.getElementById('pdf-bar').classList.remove('hidden')
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}

function removePdf() {
  attachedPdf = null
  document.getElementById('pdf-bar').classList.add('hidden')
}

// ── Send message ───────────────────────────────────────────────────────────
function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

async function sendMessage() {
  if (isSending) return
  const input = document.getElementById('message-input')
  const text = input.value.trim()
  if (!text) return

  const token = getAccessToken()
  if (!token) {
    window.location.href = '/login.html'
    return
  }

  isSending = true
  input.value = ''
  autoResize(input)
  document.getElementById('empty-state').classList.add('hidden')

  // Show user bubble
  const userMsg = { role: 'user', content: text, hasPdf: !!attachedPdf }
  currentMessages.push(userMsg)
  appendBubble('user', text)

  // Show empty assistant bubble
  const assistantRow = createBubbleRow('assistant')
  const bubble = assistantRow.querySelector('.msg-bubble')
  document.getElementById('chat-messages').appendChild(assistantRow)
  scrollToBottom()

  const pdf = attachedPdf?.base64 || null
  removePdf()

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: currentMessages.slice(0, -1).concat({ role: 'user', content: text }),
        language: currentLang,
        pdf
      })
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      if (res.status === 401) {
        window.location.href = '/login.html'
        return
      }
      bubble.textContent = I18N[currentLang].aiError
      isSending = false
      return
    }

    const fullText = await consumeStream(res, bubble)
    const assistantMsg = { role: 'assistant', content: fullText, hasPdf: false }
    currentMessages.push(assistantMsg)

    // Save to history
    await saveExchange([userMsg, assistantMsg], token)

  } catch {
    if (navigator.onLine === false) {
      bubble.textContent = I18N[currentLang].networkError
    } else {
      bubble.textContent = I18N[currentLang].aiError
    }
  } finally {
    isSending = false
  }
}

async function consumeStream(response, bubble) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6))
        if (event.type === 'text') {
          fullText += event.text
          bubble.innerHTML = marked.parse(fullText)
          scrollToBottom()
        }
        if (event.type === 'error') {
          bubble.textContent = event.message
        }
      } catch {}
    }
  }

  return fullText
}

// ── History persistence ────────────────────────────────────────────────────
async function saveExchange(newMessages, token) {
  const body = {
    conversationId: currentConversationId,
    language: currentLang,
    messages: newMessages.map(m => ({ role: m.role, content: m.content, has_pdf: m.hasPdf || false }))
  }

  const res = await fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  })

  if (res.ok) {
    const { conversationId } = await res.json()
    if (!currentConversationId) {
      currentConversationId = conversationId
      const title = newMessages[0].content.slice(0, 50)
      document.getElementById('conversation-title').textContent = title
    }
    await loadConversations()
  }
}

// ── Bubble rendering ───────────────────────────────────────────────────────
function createBubbleRow(role) {
  const row = document.createElement('div')
  row.className = `chat-bubble-row flex gap-3 ${role === 'user' ? 'flex-row-reverse' : ''}`

  const avatar = document.createElement('div')
  avatar.className = `w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${role === 'user' ? 'bg-[#1F4E79] text-white' : 'bg-blue-100 dark:bg-blue-900 text-[#1F4E79] dark:text-blue-300'}`
  avatar.textContent = role === 'user' ? 'Ti' : 'SB'

  const bubble = document.createElement('div')
  bubble.className = `msg-bubble max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${role === 'user' ? 'bg-[#1F4E79] text-white' : 'bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 text-slate-800 dark:text-gray-100'}`

  row.appendChild(avatar)
  row.appendChild(bubble)
  return row
}

function appendBubble(role, content) {
  const row = createBubbleRow(role)
  const bubble = row.querySelector('.msg-bubble')
  if (role === 'assistant') {
    bubble.innerHTML = marked.parse(content)
  } else {
    bubble.textContent = content
  }
  document.getElementById('chat-messages').appendChild(row)
  scrollToBottom()
}

// ── Utilities ──────────────────────────────────────────────────────────────
function scrollToBottom() {
  const el = document.getElementById('chat-messages')
  el.scrollTop = el.scrollHeight
}

function autoResize(el) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 128) + 'px'
}

function showError(msg) {
  alert(msg)
}

// ── Settings modal ─────────────────────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden')
  updateThemeButtons()
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden')
}

function closeSettingsOnOverlay(e) {
  if (e.target === e.currentTarget) closeSettings()
}

function updateThemeButtons() {
  const theme = getCurrentTheme()
  const activeClass = 'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition bg-[#1F4E79] text-white border-[#1F4E79]'
  const inactiveClass = 'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300 border-slate-200 dark:border-gray-600'
  document.getElementById('theme-light-btn').className = theme === 'light' ? activeClass : inactiveClass
  document.getElementById('theme-dark-btn').className = theme === 'dark' ? activeClass : inactiveClass
}
