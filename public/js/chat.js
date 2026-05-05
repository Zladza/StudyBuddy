/* global sb, I18N, marked, getSession, requireSession, signOut, getAccessToken, initAuth, renderMathInElement, hljs, setColorTheme, getCurrentColorTheme, COLOR_PALETTES */

// ── State ──────────────────────────────────────────────────────────────────
let currentLang = localStorage.getItem('sb-lang') || (navigator.language.startsWith('sr') ? 'sr' : 'en')
let currentProvider = localStorage.getItem('sb-provider') || 'claude'
let currentConversationId = null
let openConvMenuId = null
let currentSubjectFilter = null
let currentNoteId = null
let notesCache = []
let noteSaveTimer = null
let currentMessages = []
let conversations = []
let attachedFiles = []
let isSending = false
let currentDisplayName = null
let historySearch = ''
let currentAbortController = null
let activeTyperCancel = null
let userScrolledUp = false
let flashcards = []
let flashcardIndex = 0
let flashcardFlipped = false
let quizQuestions = []
let quizIndex = 0
let quizScore = 0
let quizAnswered = false
let currentSummary = null
let currentGroupId = null
let currentGroupData = null
let groupRealtimeChannel = null
let groupsList = []
let currentUserId = null

// ── Boot ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const session = await requireSession()
  if (!session) return

  const email = session.user.email
  currentUserId = session.user.id
  const displayName = session.user.user_metadata?.display_name
  currentDisplayName = displayName || null
  const username = displayName || email.split('@')[0]

  document.getElementById('user-email') && (document.getElementById('user-email').textContent = email)
  document.getElementById('greeting').textContent = `${I18N[currentLang].greeting}, ${username}! 👋`
  document.getElementById('greeting-subtitle').textContent = I18N[currentLang].greetingSubtitle

  updateProfileAvatar(username)
  applyLanguage(currentLang)
  updateProviderButtons()
  updateColorSwatches()
  setupScrollButton()
  setupFlashcardKeyboard()
  setupSwipeSidebar()
  setupOutsideClick()
  await loadConversations()
  await loadGroups()

  if (!displayName && email !== 'preview@studybuddy.rs') {
    document.getElementById('name-modal').classList.remove('hidden')
    document.getElementById('name-input').focus()
  }

  const convParam = new URLSearchParams(location.search).get('conv')
  if (convParam) {
    history.replaceState(null, '', '/')
    loadConversation(convParam)
  }
})

// ── Profile avatar ─────────────────────────────────────────────────────────
function updateProfileAvatar(username) {
  const el = document.getElementById('profile-avatar')
  if (!el) return
  const initial = (username || '?')[0].toUpperCase()
  el.textContent = initial
  el.title = username || ''
}

// ── Name modal ─────────────────────────────────────────────────────────────
async function saveName() {
  const input = document.getElementById('name-input')
  const name = input.value.trim()
  if (!name) { input.focus(); return }

  const btn = document.getElementById('name-save-btn')
  btn.disabled = true

  if (!sb) await initAuth()
  const { error } = await sb.auth.updateUser({ data: { display_name: name } })

  if (error) {
    showToast(I18N[currentLang].aiError, 'error')
    btn.disabled = false
    return
  }

  currentDisplayName = name
  document.getElementById('name-modal').classList.add('hidden')
  document.getElementById('greeting').textContent = `${I18N[currentLang].greeting}, ${name}! 👋`
  updateProfileAvatar(name)
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const colors = { error: 'bg-red-500', success: 'bg-green-600', info: 'bg-slate-700' }
  const toast = document.createElement('div')
  toast.className = `fixed bottom-6 right-4 z-[70] px-4 py-2.5 rounded-xl text-sm font-medium text-white shadow-lg max-w-xs ${colors[type] || colors.info}`
  toast.textContent = msg
  document.body.appendChild(toast)
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s'
    toast.style.opacity = '0'
    setTimeout(() => toast.remove(), 300)
  }, 2500)
}

function showError(msg) { showToast(msg, 'error') }

// ── Language ───────────────────────────────────────────────────────────────
function setLanguage(lang) {
  currentLang = lang
  localStorage.setItem('sb-lang', lang)
  applyLanguage(lang)
}

function applyLanguage(lang) {
  const t = I18N[lang]

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n
    if (t[key]) el.textContent = t[key]
  })

  document.getElementById('btn-new-chat').textContent = t.newChat
  document.getElementById('disclaimer').textContent = t.disclaimer
  document.getElementById('message-input').placeholder = t.inputPlaceholder
  document.getElementById('btn-logout').textContent = t.logout
  const groupInputEl = document.getElementById('group-input')
  if (groupInputEl) groupInputEl.placeholder = t.groupInputPlaceholder

  const username = currentDisplayName || (document.getElementById('user-email')?.textContent || '').split('@')[0]
  document.getElementById('greeting').textContent = `${t.greeting}, ${username}! 👋`
  document.getElementById('greeting-subtitle').textContent = t.greetingSubtitle

  const searchInput = document.getElementById('history-search')
  if (searchInput) searchInput.placeholder = t.searchPlaceholder

  if (!currentConversationId) {
    document.getElementById('conversation-title').textContent = t.newChat
  }

  const noteTitleEl = document.getElementById('note-title-input')
  if (noteTitleEl) noteTitleEl.placeholder = t.noteTitlePlaceholder
  const noteContentEl = document.getElementById('note-content-input')
  if (noteContentEl) noteContentEl.placeholder = t.notesPlaceholder
  const notesEmptyEl = document.getElementById('notes-empty')
  if (notesEmptyEl) notesEmptyEl.textContent = t.notesEmpty
  const subjectInputEl = document.getElementById('new-subject-input')
  if (subjectInputEl) subjectInputEl.placeholder = t.newSubjectPlaceholder
  const shareLinkEl = document.getElementById('share-link-input')
  if (shareLinkEl && !shareLinkEl.value) shareLinkEl.placeholder = t.linkGenerating

  updateLanguageButtons()
  updateProviderButtons()
  renderConversationList()
  renderSubjectsList()
  renderGroupsList()
}

function updateLanguageButtons() {
  const srBtn = document.getElementById('settings-lang-sr')
  const enBtn = document.getElementById('settings-lang-en')
  if (!srBtn || !enBtn) return
  const activeClass = 'flex-1 py-1.5 text-xs font-semibold rounded-md transition bg-white dark:bg-gray-800 text-slate-800 dark:text-gray-100 shadow-sm'
  const inactiveClass = 'flex-1 py-1.5 text-xs font-semibold rounded-md transition text-slate-500 dark:text-gray-400'
  srBtn.className = currentLang === 'sr' ? activeClass : inactiveClass
  enBtn.className = currentLang === 'en' ? activeClass : inactiveClass
}

function setProvider(provider) {
  currentProvider = provider
  localStorage.setItem('sb-provider', provider)
  updateProviderButtons()
}

function updateProviderButtons() {
  const claudeBtn = document.getElementById('settings-provider-claude')
  const openaiBtn = document.getElementById('settings-provider-openai')
  if (!claudeBtn || !openaiBtn) return
  const activeClass = 'flex-1 py-1.5 text-xs font-semibold rounded-md transition bg-white dark:bg-gray-800 text-slate-800 dark:text-gray-100 shadow-sm'
  const inactiveClass = 'flex-1 py-1.5 text-xs font-semibold rounded-md transition text-slate-500 dark:text-gray-400'
  claudeBtn.className = currentProvider === 'claude' ? activeClass : inactiveClass
  openaiBtn.className = currentProvider === 'openai' ? activeClass : inactiveClass
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

// ── Scroll button ──────────────────────────────────────────────────────────
function setupScrollButton() {
  const chatEl = document.getElementById('chat-messages')
  const btn = document.getElementById('scroll-bottom-btn')
  chatEl.addEventListener('scroll', () => {
    const atBottom = chatEl.scrollHeight - chatEl.clientHeight - chatEl.scrollTop < 80
    btn.classList.toggle('hidden', atBottom)
    userScrolledUp = !atBottom
  })
}

function scrollToBottomIfAtBottom() {
  const chatEl = document.getElementById('chat-messages')
  const distFromBottom = chatEl.scrollHeight - chatEl.clientHeight - chatEl.scrollTop
  if (distFromBottom < 40) scrollToBottom()
}

// ── Color theme ────────────────────────────────────────────────────────────
function updateColorSwatches() {
  const current = getCurrentColorTheme()
  document.querySelectorAll('.color-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.color === current)
  })
}

// ── Conversations ──────────────────────────────────────────────────────────
async function loadConversations() {
  const token = getAccessToken()
  if (!token) return
  const res = await fetch('/api/history', { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return
  conversations = await res.json()
  renderConversationList()
  renderSubjectsList()
}

function filterHistory(query) {
  historySearch = query
  renderConversationList()
}

function getTopicEmoji(title) {
  const t = title.toLowerCase()
  if (/\b(kod|kod|python|java|c\+\+|javascript|programi|algoritam|baza|sql|web|html|css|api|softver|hardware|računar|compute|debug|function|class|array|loop|variable)\b/.test(t)) return '💻'
  if (/\b(matematika|algebra|analiza|integral|derivat|formula|jednačina|geometrija|statistika|verovatnoća|math|calculus|equation|matrix|vektor)\b/.test(t)) return '📐'
  if (/\b(fizika|mehanika|termodinamika|elektromagnetizam|optika|kvantna|physics|sila|energija|brzina|talasi)\b/.test(t)) return '⚡'
  if (/\b(hemija|atom|molekul|reakcija|element|periodni|chemistry|organic|acid|base)\b/.test(t)) return '🧪'
  if (/\b(biologija|ćelija|dna|evolucija|genetika|ekolog|biology|cell|organism)\b/.test(t)) return '🔬'
  if (/\b(istorija|history|rat|revolucija|empire|period|vek|century)\b/.test(t)) return '🏛️'
  if (/\b(ekonomija|economics|market|tržište|profit|bankars|finansije|finance)\b/.test(t)) return '📊'
  if (/\b(pravo|zakon|law|ustav|sudnica|ugovor|legal)\b/.test(t)) return '⚖️'
  if (/\b(seminarski|essay|rad|tema|struktura|outline)\b/.test(t)) return '✍️'
  if (/\b(ispit|exam|test|pitanje|question|kolokvijum|quiz)\b/.test(t)) return '📝'
  return '📚'
}

function renderConversationList() {
  const section = document.getElementById('history-section')
  const list = document.getElementById('history-list')
  list.innerHTML = ''

  if (conversations.length === 0) { section.classList.add('hidden'); return }
  section.classList.remove('hidden')

  const t = I18N[currentLang]
  const now = new Date()
  const subjectMap = getSubjectMap()
  let filtered = historySearch
    ? conversations.filter(c => c.title.toLowerCase().includes(historySearch.toLowerCase()))
    : conversations
  if (currentSubjectFilter) {
    filtered = filtered.filter(c => subjectMap[c.id] === currentSubjectFilter)
  }

  const groups = { today: [], yesterday: [], thisWeek: [], older: [] }
  filtered.forEach(conv => {
    const d = new Date(conv.updated_at)
    const diffDays = Math.floor((now - d) / 86400000)
    if (diffDays < 1) groups.today.push(conv)
    else if (diffDays < 2) groups.yesterday.push(conv)
    else if (diffDays < 7) groups.thisWeek.push(conv)
    else groups.older.push(conv)
  })

  const labels = { today: t.today, yesterday: t.yesterday, thisWeek: t.thisWeek, older: t.older }

  Object.entries(groups).forEach(([key, items]) => {
    if (items.length === 0) return

    const label = document.createElement('p')
    label.className = 'text-blue-300/60 text-[9px] font-bold uppercase tracking-widest px-1 pt-2 pb-0.5'
    label.textContent = labels[key]
    list.appendChild(label)

    items.forEach(conv => {
      const item = document.createElement('div')
      item.className = 'conv-item relative flex items-center gap-1 w-full'

      const btn = document.createElement('div')
      btn.className = `flex-1 py-1.5 rounded-lg text-white/80 hover:bg-white/10 text-xs text-left transition truncate px-2 cursor-pointer${conv.id === currentConversationId ? ' bg-white/15' : ''}`
      btn.textContent = conv.title
      btn.dataset.convTitleBtn = conv.id
      btn.tabIndex = 0
      btn.onclick = () => loadConversation(conv.id)
      btn.onkeydown = e => { if (e.key === 'Enter') loadConversation(conv.id) }

      const menuBtn = document.createElement('button')
      menuBtn.className = 'del-btn shrink-0 px-1 py-1 text-white/40 hover:text-white/80 transition rounded text-sm leading-none tracking-widest'
      menuBtn.textContent = '⋯'
      menuBtn.onclick = (e) => { e.stopPropagation(); const rect = menuBtn.getBoundingClientRect(); toggleConvMenu(conv.id, rect) }

      const dropdown = document.createElement('div')
      dropdown.id = `conv-menu-${conv.id}`
      dropdown.className = 'hidden fixed bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl shadow-lg py-1 z-[60] w-36'

      const moveBtn = document.createElement('button')
      moveBtn.className = 'w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-gray-700 transition'
      moveBtn.textContent = I18N[currentLang].moveToSubject
      moveBtn.onclick = (e) => { e.stopPropagation(); closeAllConvMenus(); openMoveSubjectModal(conv.id) }

      const deleteBtn = document.createElement('button')
      deleteBtn.className = 'w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-slate-50 dark:hover:bg-gray-700 transition'
      deleteBtn.textContent = I18N[currentLang].deleteConv2
      deleteBtn.onclick = (e) => { e.stopPropagation(); closeAllConvMenus(); deleteConversation(conv.id) }

      dropdown.appendChild(moveBtn)
      dropdown.appendChild(deleteBtn)

      item.appendChild(btn)
      item.appendChild(menuBtn)
      item.appendChild(dropdown)
      list.appendChild(item)
    })
  })
}

async function loadConversation(id) {
  const token = getAccessToken()
  if (!token) return
  const res = await fetch(`/api/history/${id}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return

  const { conversation, messages } = await res.json()
  currentConversationId = id
  currentMessages = messages.map(m => ({ role: m.role, content: m.content, hasPdf: m.has_pdf }))

  document.getElementById('conversation-title').textContent = conversation.title
  document.getElementById('empty-state').classList.add('hidden')
  updateAttachToolsVisibility()

  document.querySelectorAll('.chat-bubble-row, .continue-banner').forEach(el => el.remove())
  currentMessages.forEach(m => {
    const row = appendBubble(m.role, m.content)
    const isToolMsg = m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('{"__tool__":')
    if (m.role === 'assistant' && !isToolMsg) addBubbleActions(row)
  })

  renderConversationList()
  closeSidebar()
  scrollToBottom()
  setupTitleEdit()
  attachedFiles = []
  await loadConversationFiles(id)
}

async function loadConversationFiles(conversationId) {
  const token = getAccessToken()
  if (!token) return
  try {
    const res = await fetch(`/api/conversations/${conversationId}/files`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return
    const files = await res.json()
    if (!files.length) return
    attachedFiles = files.map(f => ({
      id: f.id,
      name: f.name,
      mime_type: f.mime_type,
      size: f.size,
      signedUrl: f.signedUrl,
      base64: null
    }))
    renderAttachedFilesBar()
  } catch {}
}

// ── Delete conversation ────────────────────────────────────────────────────
async function deleteConversation(id) {
  const token = getAccessToken()
  if (!token) return

  const res = await fetch(`/api/history/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  })

  if (!res.ok) { showToast(I18N[currentLang].deleteError, 'error'); return }
  if (currentConversationId === id) startNewChat()
  showToast(I18N[currentLang].deleteSuccess, 'success')
  await loadConversations()
}

// ── Title editing ──────────────────────────────────────────────────────────
function setupTitleEdit() {
  const titleEl = document.getElementById('conversation-title')
  if (!currentConversationId) {
    titleEl.onclick = null; titleEl.style.cursor = 'default'; titleEl.removeAttribute('title'); return
  }
  titleEl.style.cursor = 'pointer'
  titleEl.title = I18N[currentLang].editTitle
  titleEl.onclick = startTitleEdit
}

function startTitleEdit() {
  const titleEl = document.getElementById('conversation-title')
  if (titleEl.querySelector('input')) return
  const current = titleEl.textContent
  titleEl.textContent = ''
  const input = document.createElement('input')
  input.type = 'text'; input.value = current; input.maxLength = 80
  input.className = 'bg-transparent outline-none text-sm font-medium text-slate-600 dark:text-gray-300 border-b border-slate-400 dark:border-gray-500 w-36'
  const finish = async () => {
    const newTitle = input.value.trim() || current
    titleEl.textContent = newTitle
    if (newTitle !== current && currentConversationId) await patchConversationTitle(currentConversationId, newTitle)
    setupTitleEdit()
  }
  input.onblur = finish
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur() }
    if (e.key === 'Escape') { titleEl.textContent = current; setupTitleEdit() }
  }
  titleEl.appendChild(input)
  input.select()
}

async function patchConversationTitle(id, title) {
  const token = getAccessToken()
  if (!token) return
  const res = await fetch(`/api/history/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title })
  })
  if (!res.ok) { showToast(I18N[currentLang].aiError, 'error'); return }
  const conv = conversations.find(c => c.id === id)
  if (conv) conv.title = title
  renderConversationList()
}

// ── New chat ───────────────────────────────────────────────────────────────
function startNewChat() {
  currentConversationId = null
  currentMessages = []
  attachedFiles = []
  renderAttachedFilesBar()
  document.getElementById('conversation-title').textContent = I18N[currentLang].newChat
  document.querySelectorAll('.chat-bubble-row').forEach(el => el.remove())
  document.getElementById('empty-state').classList.remove('hidden')
  document.getElementById('message-input').value = ''
  closeAttachPanel()
  updateAttachToolsVisibility()
  renderConversationList()
  closeSidebar()
  setupTitleEdit()
}

// ── Attached files bar ────────────────────────────────────────────────────
function renderAttachedFilesBar() {
  const bar = document.getElementById('conv-files-bar')
  if (!bar) return
  bar.innerHTML = ''
  if (!attachedFiles.length) { bar.classList.add('hidden'); return }
  bar.classList.remove('hidden')
  attachedFiles.forEach(f => {
    const chip = document.createElement('div')
    chip.className = `flex items-center gap-1.5 bg-slate-100 dark:bg-gray-700 rounded-lg px-3 py-1.5 flex-shrink-0 max-w-[200px]${f.uploading ? ' opacity-60' : ''}`
    const icon = f.uploading ? '⏳' : (f.mime_type === 'application/pdf' ? '📄' : '🖼️')
    const nameEl = document.createElement('span')
    nameEl.className = 'text-xs text-slate-700 dark:text-gray-200 truncate'
    nameEl.textContent = `${icon} ${f.name}`
    if (f.signedUrl && !f.uploading) {
      nameEl.style.cursor = 'pointer'
      nameEl.onclick = () => window.open(f.signedUrl, '_blank')
    }
    const removeBtn = document.createElement('button')
    removeBtn.className = 'text-slate-400 hover:text-red-500 text-sm leading-none flex-shrink-0'
    removeBtn.textContent = '×'
    removeBtn.onclick = () => { attachedFiles = attachedFiles.filter(af => af !== f); renderAttachedFilesBar() }
    chip.appendChild(nameEl)
    chip.appendChild(removeBtn)
    bar.appendChild(chip)
  })
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
  if (currentProvider === 'openai') { showError(I18N[currentLang].pdfNotSupportedOpenAI); return }
  if (file.size > 20 * 1024 * 1024) { showError(I18N[currentLang].fileTooLarge); return }
  const reader = new FileReader()
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1]
    const fileEntry = { name: file.name, mime_type: 'application/pdf', base64, size: file.size, id: null, signedUrl: null, uploading: true }
    attachedFiles.push(fileEntry)
    renderAttachedFilesBar()
    const token = getAccessToken()
    if (token) {
      try {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: file.name, mime_type: 'application/pdf', size: file.size, base64 })
        })
        if (res.ok) {
          const data = await res.json()
          fileEntry.id = data.id
          fileEntry.signedUrl = data.signedUrl
          if (currentConversationId) {
            fetch(`/api/conversations/${currentConversationId}/files`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ fileId: data.id })
            }).catch(() => {})
          }
        }
      } catch (err) { console.warn('File upload failed:', err) }
    }
    fileEntry.uploading = false
    renderAttachedFilesBar()
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}

// ── Image handling ─────────────────────────────────────────────────────────
function handleImageSelect(event) {
  const file = event.target.files[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) { showError(I18N[currentLang].imageTooLarge); return }
  const reader = new FileReader()
  reader.onload = async (e) => {
    const dataUrl = e.target.result
    const base64 = dataUrl.split(',')[1]
    const fileEntry = { name: file.name, mime_type: file.type, base64, size: file.size, id: null, signedUrl: null, uploading: true }
    attachedFiles.push(fileEntry)
    renderAttachedFilesBar()
    const token = getAccessToken()
    if (token) {
      try {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: file.name, mime_type: file.type, size: file.size, base64 })
        })
        if (res.ok) {
          const data = await res.json()
          fileEntry.id = data.id
          fileEntry.signedUrl = data.signedUrl
          if (currentConversationId) {
            fetch(`/api/conversations/${currentConversationId}/files`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ fileId: data.id })
            }).catch(() => {})
          }
        }
      } catch (err) { console.warn('File upload failed:', err) }
    }
    fileEntry.uploading = false
    renderAttachedFilesBar()
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}

// ── Send / Stop ────────────────────────────────────────────────────────────
function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
}

function updateSendButton(sending) {
  const btn = document.getElementById('send-btn')
  if (sending) {
    btn.textContent = '■'
    btn.classList.remove('accent-btn')
    btn.style.backgroundColor = '#ef4444'
    btn.onclick = stopGeneration
  } else {
    btn.textContent = '↑'
    btn.classList.add('accent-btn')
    btn.style.backgroundColor = ''
    btn.onclick = sendMessage
  }
}

function stopGeneration() {
  if (currentAbortController) { currentAbortController.abort(); currentAbortController = null }
  if (activeTyperCancel) { activeTyperCancel(); activeTyperCancel = null }
}

async function sendMessage() {
  if (isSending) return
  const input = document.getElementById('message-input')
  const text = input.value.trim()
  if (!text && !attachedFiles.length) return

  const token = getAccessToken()
  if (!token) { window.location.href = '/login.html'; return }

  userScrolledUp = false

  isSending = true
  input.value = ''
  autoResize(input)
  updateSendButton(true)
  document.getElementById('empty-state').classList.add('hidden')

  const firstFile = attachedFiles[0]
  const displayText = text || (firstFile ? (firstFile.mime_type === 'application/pdf' ? '📎 ' : '🖼️ ') + firstFile.name : '')
  const userMsg = { role: 'user', content: displayText, hasPdf: attachedFiles.some(f => f.mime_type === 'application/pdf'), sentAt: Date.now() }
  currentMessages.push(userMsg)
  appendBubble('user', displayText, userMsg.sentAt)

  const assistantRow = createBubbleRow('assistant')
  const bubble = assistantRow.querySelector('.msg-bubble')
  bubble.innerHTML = `<span class="typing-indicator"><span class="thinking-label">${I18N[currentLang].thinking}</span><span class="typing-dots"><span></span><span></span><span></span></span></span>`
  document.getElementById('chat-messages').appendChild(assistantRow)
  scrollToBottom()

  const filesSnapshot = [...attachedFiles]
  attachedFiles = []
  renderAttachedFilesBar()

  try {
    const resolvedFiles = await Promise.all(filesSnapshot.map(async f => {
      if (f.base64) return f
      if (!f.signedUrl) return null
      try {
        const fileRes = await fetch(f.signedUrl)
        if (!fileRes.ok) return null
        const blob = await fileRes.blob()
        const base64 = await new Promise(resolve => {
          const reader = new FileReader()
          reader.onload = e => resolve(e.target.result.split(',')[1])
          reader.readAsDataURL(blob)
        })
        return { ...f, base64 }
      } catch (err) { console.warn('Failed to resolve file for send:', err); return null }
    }))
    const filesToSend = resolvedFiles.filter(Boolean).filter(f => f.base64)
    if (filesToSend.length < filesSnapshot.length) {
      showToast(I18N[currentLang].fileResolveFailed, 'error')
    }

    currentAbortController = new AbortController()
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: currentMessages.slice(0, -1).concat({ role: 'user', content: text }),
        language: currentLang,
        provider: currentProvider,
        files: filesToSend.map(f => ({ base64: f.base64, mediaType: f.mime_type, name: f.name }))
      }),
      signal: currentAbortController.signal
    })

    if (!res.ok) {
      if (res.status === 401) { window.location.href = '/login.html'; return }
      bubble.innerHTML = ''; bubble.textContent = I18N[currentLang].aiError
      isSending = false; updateSendButton(false); return
    }

    const sentAt = Date.now()
    const fullText = await consumeStream(res, bubble)
    const assistantMsg = { role: 'assistant', content: fullText, hasPdf: false, sentAt }
    currentMessages.push(assistantMsg)

    updateTimestamp(assistantRow, sentAt)
    addBubbleActions(assistantRow)
    loadFollowupQuestions(assistantRow)
    await saveExchange([userMsg, assistantMsg], token)
    // Link stored files to conversation (non-blocking)
    if (currentConversationId) {
      const storedFiles = filesSnapshot.filter(f => f.id)
      storedFiles.forEach(f => {
        fetch(`/api/conversations/${currentConversationId}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ fileId: f.id })
        }).catch(() => {})
      })
    }

  } catch (err) {
    if (err.name !== 'AbortError') {
      bubble.innerHTML = ''
      bubble.textContent = navigator.onLine === false ? I18N[currentLang].networkError : I18N[currentLang].aiError
    }
  } finally {
    isSending = false
    currentAbortController = null
    updateSendButton(false)
  }
}

async function consumeStream(response, bubble) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', fullText = '', started = false

  // Typewriter state
  let charQueue = ''
  let typedSoFar = ''
  let streamDone = false
  let typerCancelled = false
  let typerResolve = null

  activeTyperCancel = () => { typerCancelled = true }

  function runTyper() {
    if (typerCancelled) { if (typerResolve) typerResolve(); return }

    if (charQueue.length > 0) {
      // Drain faster when the queue builds up so we never fall far behind
      const take = charQueue.length > 100 ? 6 : charQueue.length > 30 ? 3 : 1
      typedSoFar += charQueue.slice(0, take)
      charQueue = charQueue.slice(take)
      bubble.innerHTML = marked.parse(typedSoFar)
      applyContentEnhancements(bubble)
      scrollToBottomIfAtBottom()
    }

    if (!streamDone || charQueue.length > 0) {
      setTimeout(runTyper, 16)
    } else {
      if (typerResolve) typerResolve()
    }
  }

  const typerDone = new Promise(resolve => { typerResolve = resolve })
  setTimeout(runTyper, 16)

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
          if (!started) { started = true; bubble.innerHTML = '' }
          fullText += event.text
          charQueue += event.text
        }
        if (event.type === 'error') {
          typerCancelled = true
          bubble.innerHTML = ''
          bubble.textContent = event.message
        }
      } catch {}
    }
  }

  streamDone = true
  await typerDone

  if (!typerCancelled) {
    bubble.innerHTML = marked.parse(typedSoFar)
    applyContentEnhancements(bubble)
  }

  activeTyperCancel = null
  return fullText
}

// ── Content enhancements (math + syntax) ──────────────────────────────────
function applyContentEnhancements(el) {
  if (typeof hljs !== 'undefined') {
    el.querySelectorAll('pre code').forEach(block => {
      if (!block.dataset.highlighted) hljs.highlightElement(block)
    })
  }

  el.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-copy-btn')) return
    pre.style.position = 'relative'
    const btn = document.createElement('button')
    btn.className = 'code-copy-btn'
    btn.textContent = I18N[currentLang].copyBtn
    btn.onclick = async (e) => {
      e.stopPropagation()
      const code = pre.querySelector('code')
      try {
        await navigator.clipboard.writeText(code?.innerText || pre.innerText)
        btn.textContent = I18N[currentLang].copied
        setTimeout(() => { btn.textContent = I18N[currentLang].copyBtn }, 2000)
      } catch {}
    }
    pre.appendChild(btn)
  })
  if (typeof renderMathInElement !== 'undefined') {
    try {
      renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false
      })
    } catch {}
  }
}

// ── Bubble actions (copy + regenerate) ────────────────────────────────────
function addBubbleActions(row) {
  const wrapper = row.querySelector('.bubble-wrapper')
  if (!wrapper || wrapper.querySelector('.bubble-actions')) return

  const actions = document.createElement('div')
  actions.className = 'bubble-actions flex gap-1'

  const copyBtn = document.createElement('button')
  copyBtn.className = 'text-xs text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-200 px-2 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-gray-700 transition'
  copyBtn.dataset.i18n = 'copyBtn'
  copyBtn.textContent = I18N[currentLang].copyBtn
  copyBtn.onclick = async () => {
    const bubble = row.querySelector('.msg-bubble')
    try {
      await navigator.clipboard.writeText(bubble.innerText)
      copyBtn.textContent = I18N[currentLang].copied
      showToast(I18N[currentLang].copied, 'success')
      setTimeout(() => { copyBtn.textContent = I18N[currentLang].copyBtn }, 2000)
    } catch { showToast(I18N[currentLang].aiError, 'error') }
  }

  const regenBtn = document.createElement('button')
  regenBtn.className = 'text-xs text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-200 px-2 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-gray-700 transition'
  regenBtn.textContent = '↺'
  regenBtn.title = I18N[currentLang].regenerate
  regenBtn.onclick = () => regenerateFrom(row)

  actions.appendChild(copyBtn)
  actions.appendChild(regenBtn)
  wrapper.appendChild(actions)
}

// ── Follow-up questions ────────────────────────────────────────────────────
async function loadFollowupQuestions(assistantRow) {
  const token = getAccessToken()
  if (!token || currentMessages.length < 2) return

  try {
    const res = await fetch('/api/followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: currentMessages.slice(-4).map(m => ({ role: m.role, content: m.content })),
        language: currentLang
      })
    })
    if (!res.ok) return
    const { questions } = await res.json()
    if (!questions || questions.length === 0) return

    const wrapper = assistantRow.querySelector('.bubble-wrapper')
    if (!wrapper) return

    const chips = document.createElement('div')
    chips.className = 'followup-chips'

    const label = document.createElement('p')
    label.className = 'text-[10px] text-slate-400 dark:text-gray-500 w-full mb-0.5'
    label.textContent = I18N[currentLang].followUpTitle
    chips.appendChild(label)

    questions.forEach(q => {
      const chip = document.createElement('button')
      chip.className = 'followup-chip'
      chip.textContent = q
      chip.onclick = () => {
        document.getElementById('message-input').value = q
        autoResize(document.getElementById('message-input'))
        document.getElementById('message-input').focus()
      }
      chips.appendChild(chip)
    })

    wrapper.appendChild(chips)
    scrollToBottom()
  } catch {}
}

// ── Regenerate ─────────────────────────────────────────────────────────────
async function regenerateFrom(assistantRow) {
  if (isSending) return
  const token = getAccessToken()
  if (!token) return

  const rows = [...document.querySelectorAll('.chat-bubble-row')]
  const idx = rows.indexOf(assistantRow)
  if (idx < 0) return

  rows.slice(idx).forEach(r => r.remove())
  currentMessages.splice(idx)

  const newRow = createBubbleRow('assistant')
  const bubble = newRow.querySelector('.msg-bubble')
  bubble.innerHTML = `<span class="typing-indicator"><span class="thinking-label">${I18N[currentLang].thinking}</span><span class="typing-dots"><span></span><span></span><span></span></span></span>`
  document.getElementById('chat-messages').appendChild(newRow)
  scrollToBottom()

  isSending = true
  updateSendButton(true)

  try {
    currentAbortController = new AbortController()
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: currentMessages.map(m => ({ role: m.role, content: m.content })),
        language: currentLang
      }),
      signal: currentAbortController.signal
    })

    if (!res.ok) { bubble.innerHTML = ''; bubble.textContent = I18N[currentLang].aiError; return }

    const sentAt = Date.now()
    const fullText = await consumeStream(res, bubble)
    const assistantMsg = { role: 'assistant', content: fullText, hasPdf: false, sentAt }
    currentMessages.push(assistantMsg)
    updateTimestamp(newRow, sentAt)
    addBubbleActions(newRow)
    loadFollowupQuestions(newRow)

    if (currentConversationId) await syncConversation(token)

  } catch (err) {
    if (err.name !== 'AbortError') { bubble.innerHTML = ''; bubble.textContent = I18N[currentLang].aiError }
  } finally {
    isSending = false; currentAbortController = null; updateSendButton(false)
  }
}

// ── Edit message ───────────────────────────────────────────────────────────
function startEditMessage(row) {
  if (isSending) return
  const bubble = row.querySelector('.msg-bubble')
  const rows = [...document.querySelectorAll('.chat-bubble-row')]
  const idx = rows.indexOf(row)
  if (idx < 0) return

  const originalText = currentMessages[idx]?.content || bubble.textContent

  bubble.textContent = ''
  const ta = document.createElement('textarea')
  ta.value = originalText
  ta.className = 'w-full bg-transparent outline-none text-sm text-white resize-none leading-relaxed'
  ta.rows = Math.max(2, Math.ceil(originalText.length / 40))
  bubble.appendChild(ta)

  const btnRow = document.createElement('div')
  btnRow.className = 'flex gap-2 mt-2'

  const saveBtn = document.createElement('button')
  saveBtn.textContent = I18N[currentLang].saveEdit
  saveBtn.className = 'text-xs bg-white/20 hover:bg-white/30 text-white px-3 py-1 rounded-lg transition'
  saveBtn.onclick = async () => {
    const newText = ta.value.trim()
    if (!newText) { cancelEdit(); return }

    rows.slice(idx + 1).forEach(r => r.remove())
    currentMessages.splice(idx + 1)
    currentMessages[idx] = { role: 'user', content: newText, hasPdf: false, sentAt: Date.now() }

    bubble.textContent = newText

    await resendFrom(idx, newText)
  }

  const cancelBtn = document.createElement('button')
  cancelBtn.textContent = I18N[currentLang].cancelEdit
  cancelBtn.className = 'text-xs text-white/60 hover:text-white px-2 py-1 rounded-lg transition'
  cancelBtn.onclick = () => { bubble.textContent = originalText }

  btnRow.appendChild(saveBtn)
  btnRow.appendChild(cancelBtn)
  bubble.appendChild(btnRow)
  ta.focus()
  ta.setSelectionRange(ta.value.length, ta.value.length)
}

async function resendFrom(userMsgIdx, text) {
  if (isSending) return
  const token = getAccessToken()
  if (!token) return

  const newRow = createBubbleRow('assistant')
  const bubble = newRow.querySelector('.msg-bubble')
  bubble.innerHTML = `<span class="typing-indicator"><span class="thinking-label">${I18N[currentLang].thinking}</span><span class="typing-dots"><span></span><span></span><span></span></span></span>`
  document.getElementById('chat-messages').appendChild(newRow)
  scrollToBottom()

  isSending = true
  updateSendButton(true)

  try {
    currentAbortController = new AbortController()
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: currentMessages.map(m => ({ role: m.role, content: m.content })),
        language: currentLang
      }),
      signal: currentAbortController.signal
    })

    if (!res.ok) { bubble.innerHTML = ''; bubble.textContent = I18N[currentLang].aiError; return }

    const sentAt = Date.now()
    const fullText = await consumeStream(res, bubble)
    const assistantMsg = { role: 'assistant', content: fullText, hasPdf: false, sentAt }
    currentMessages.push(assistantMsg)
    updateTimestamp(newRow, sentAt)
    addBubbleActions(newRow)
    loadFollowupQuestions(newRow)

    if (currentConversationId) await syncConversation(token)

  } catch (err) {
    if (err.name !== 'AbortError') { bubble.innerHTML = ''; bubble.textContent = I18N[currentLang].aiError }
  } finally {
    isSending = false; currentAbortController = null; updateSendButton(false)
  }
}

async function syncConversation(token) {
  if (!currentConversationId) return
  await fetch(`/api/history/${currentConversationId}/messages`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messages: currentMessages.map(m => ({ role: m.role, content: m.content, has_pdf: m.hasPdf || false }))
    })
  })
  await loadConversations()
}

// ── History persistence ────────────────────────────────────────────────────
async function saveExchange(newMessages, token) {
  const isNewConv = !currentConversationId
  let aiTitle = null

  if (isNewConv) {
    try {
      const titleRes = await fetch('/api/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: newMessages[0].content, language: currentLang })
      })
      if (titleRes.ok) {
        const data = await titleRes.json()
        aiTitle = data.title || null
      }
    } catch {}
  }

  const body = {
    conversationId: currentConversationId,
    language: currentLang,
    title: aiTitle,
    messages: newMessages.map(m => ({ role: m.role, content: m.content, has_pdf: m.hasPdf || false }))
  }
  const res = await fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  })
  if (res.ok) {
    const { conversationId } = await res.json()
    if (isNewConv) {
      currentConversationId = conversationId
      document.getElementById('conversation-title').textContent = aiTitle || newMessages[0].content.slice(0, 50)
      setupTitleEdit()
      updateAttachToolsVisibility()
    }
    await loadConversations()
  }
}

// ── Export conversation ────────────────────────────────────────────────────
function exportConversation() {
  if (currentMessages.length === 0) { showToast(I18N[currentLang].flashcardEmpty, 'info'); return }
  const title = document.getElementById('conversation-title').textContent
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:Inter,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#1e293b}
h1{font-size:20px;font-weight:600;margin-bottom:32px;color:#1F4E79}.msg{margin-bottom:24px}
.role{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:6px}
.content{font-size:14px;line-height:1.7}pre{background:#f1f5f9;padding:12px;border-radius:8px;overflow-x:auto}
code{background:#f1f5f9;padding:2px 4px;border-radius:4px;font-size:.875em}hr{border:none;border-top:1px solid #e2e8f0;margin:32px 0}
</style></head><body><h1>📚 ${title}</h1>`

  currentMessages.forEach((m, i) => {
    const name = m.role === 'user' ? (currentDisplayName || 'You') : 'StudyBuddy'
    const content = m.role === 'assistant'
      ? marked.parse(m.content)
      : m.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
    html += `<div class="msg"><div class="role">${name}</div><div class="content">${content}</div></div>`
    if (i < currentMessages.length - 1) html += '<hr>'
  })

  html += '</body></html>'
  const win = window.open('', '_blank')
  if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 500) }
}

// ── Flashcards ─────────────────────────────────────────────────────────────
async function generateFlashcards() {
  if (currentMessages.length === 0) { showToast(I18N[currentLang].flashcardEmpty, 'info'); return }
  const token = getAccessToken()
  if (!token) return

  const attachBtn = document.getElementById('attach-btn')
  if (attachBtn) { attachBtn.textContent = '⏳'; attachBtn.disabled = true }

  try {
    const res = await fetch('/api/flashcards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: currentMessages.map(m => ({ role: m.role, content: m.content })),
        language: currentLang
      })
    })
    if (!res.ok) { showToast(I18N[currentLang].aiError, 'error'); return }
    const { cards } = await res.json()
    if (!cards || cards.length === 0) { showToast(I18N[currentLang].flashcardEmpty, 'info'); return }
    openFlashcardModal(cards)
    saveToolResult('flashcards', { cards })
  } catch { showToast(I18N[currentLang].aiError, 'error') }
  finally { if (attachBtn) { attachBtn.textContent = '＋'; attachBtn.disabled = false } }
}

function openFlashcardModal(cards) {
  flashcards = cards
  flashcardIndex = 0
  flashcardFlipped = false
  document.getElementById('flashcard-modal').classList.remove('hidden')
  renderFlashcard()
  document.getElementById('flashcard-modal').focus()
}

function closeFlashcardModal() {
  document.getElementById('flashcard-modal').classList.add('hidden')
}

function setupFlashcardKeyboard() {
  document.addEventListener('keydown', e => {
    const modal = document.getElementById('flashcard-modal')
    if (modal.classList.contains('hidden')) return
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipCard() }
    else if (e.key === 'ArrowLeft') prevCard()
    else if (e.key === 'ArrowRight') nextCard()
    else if (e.key === 'Escape') closeFlashcardModal()
  })
}

function shuffleCards() {
  for (let i = flashcards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [flashcards[i], flashcards[j]] = [flashcards[j], flashcards[i]]
  }
  flashcardIndex = 0
  flashcardFlipped = false
  renderFlashcard()
}

function renderFlashcard() {
  if (flashcards.length === 0) return
  const card = flashcards[flashcardIndex]

  const label = document.getElementById('flashcard-label')
  const content = document.getElementById('flashcard-content')
  const counter = document.getElementById('card-counter')
  const progressBar = document.getElementById('flashcard-progress-bar')

  if (flashcardFlipped) {
    label.textContent = currentLang === 'sr' ? 'ODGOVOR' : 'ANSWER'
    label.style.color = '#16a34a'
    content.textContent = card.a
  } else {
    label.textContent = currentLang === 'sr' ? 'PITANJE' : 'QUESTION'
    label.style.color = 'var(--ac)'
    content.textContent = card.q
  }
  counter.textContent = `${flashcardIndex + 1} / ${flashcards.length}`
  if (progressBar) progressBar.style.width = `${((flashcardIndex + 1) / flashcards.length) * 100}%`

  const cardEl = document.getElementById('flashcard-card')
  cardEl.style.transition = 'opacity 0.15s'
  cardEl.style.opacity = '1'
}

function flipCard() {
  flashcardFlipped = !flashcardFlipped
  const cardEl = document.getElementById('flashcard-card')
  cardEl.style.opacity = '0'
  setTimeout(() => { renderFlashcard(); cardEl.style.opacity = '1' }, 150)
}

function prevCard() {
  if (flashcardIndex > 0) { flashcardIndex--; flashcardFlipped = false; renderFlashcard() }
}

function nextCard() {
  if (flashcardIndex < flashcards.length - 1) { flashcardIndex++; flashcardFlipped = false; renderFlashcard() }
}

// ── Bubble rendering ───────────────────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString(currentLang === 'sr' ? 'sr' : 'en', { hour: '2-digit', minute: '2-digit' })
}

function updateTimestamp(row, ts) {
  const el = row.querySelector('.msg-timestamp')
  if (el && ts) el.textContent = formatTime(ts)
}

function createBubbleRow(role) {
  const row = document.createElement('div')
  row.className = `chat-bubble-row flex gap-3 ${role === 'user' ? 'flex-row-reverse' : ''}`

  const initial = role === 'user' ? ((currentDisplayName || 'T')[0].toUpperCase()) : 'SB'
  const avatar = document.createElement('div')
  avatar.className = `w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${role === 'user' ? 'profile-avatar' : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'}`
  avatar.textContent = role === 'user' ? initial : 'SB'

  const wrapper = document.createElement('div')
  wrapper.className = `bubble-wrapper flex flex-col gap-1 min-w-0 ${role === 'user' ? 'items-end' : ''}`

  const bubble = document.createElement('div')
  if (role === 'user') {
    bubble.className = 'msg-bubble user-bubble max-w-[85%] rounded-2xl px-4 py-2.5 text-sm text-white cursor-pointer'
    bubble.title = I18N[currentLang].editMsg
    bubble.ondblclick = () => startEditMessage(row)
  } else {
    bubble.className = 'msg-bubble max-w-[85%] rounded-2xl px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 text-slate-800 dark:text-gray-100'
  }

  const timestamp = document.createElement('div')
  timestamp.className = `msg-timestamp ${role === 'user' ? 'text-right' : ''}`

  wrapper.appendChild(bubble)
  wrapper.appendChild(timestamp)
  row.appendChild(avatar)
  row.appendChild(wrapper)
  return row
}

function appendBubble(role, content, sentAt) {
  if (role === 'assistant' && typeof content === 'string' && content.startsWith('{"__tool__":')) {
    try {
      const data = JSON.parse(content)
      const { __tool__, ...rest } = data
      return appendToolResultBubble(__tool__, rest)
    } catch {}
  }
  const row = createBubbleRow(role)
  const bubble = row.querySelector('.msg-bubble')
  if (role === 'assistant') {
    bubble.innerHTML = marked.parse(content)
    applyContentEnhancements(bubble)
  } else {
    bubble.textContent = content
  }
  if (sentAt) updateTimestamp(row, sentAt)
  document.getElementById('chat-messages').appendChild(row)
  scrollToBottom()
  return row
}

function appendToolResultBubble(tool, data) {
  const t = I18N[currentLang]
  const meta = {
    flashcards: { icon: '🃏', label: t.flashcardTitle, count: data.cards?.length, unit: currentLang === 'sr' ? 'kartica' : 'cards' },
    quiz:       { icon: '🧠', label: t.quizTitle,      count: data.questions?.length, unit: currentLang === 'sr' ? 'pitanja' : 'questions' },
    glossary:   { icon: '📖', label: t.glossaryTitle,  count: data.terms?.length, unit: currentLang === 'sr' ? 'pojmova' : 'terms' },
    summary:    { icon: '📋', label: t.summaryTitle,   count: null, unit: '' },
  }
  const m = meta[tool] || { icon: '📚', label: tool, count: null, unit: '' }

  const row = document.createElement('div')
  row.className = 'chat-bubble-row flex gap-3'

  const avatar = document.createElement('div')
  avatar.className = 'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
  avatar.textContent = 'SB'

  const wrapper = document.createElement('div')
  wrapper.className = 'bubble-wrapper flex flex-col gap-1 min-w-0'

  const card = document.createElement('div')
  card.className = 'inline-flex items-center gap-3 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-2xl px-4 py-3'

  const icon = document.createElement('span')
  icon.className = 'text-xl shrink-0'
  icon.textContent = m.icon

  const textDiv = document.createElement('div')
  textDiv.className = 'flex flex-col'

  const titleEl = document.createElement('p')
  titleEl.className = 'text-sm font-semibold text-slate-800 dark:text-gray-100'
  titleEl.textContent = m.label

  if (m.count) {
    const countEl = document.createElement('p')
    countEl.className = 'text-xs text-slate-400 dark:text-gray-500'
    countEl.textContent = `${m.count} ${m.unit}`
    textDiv.appendChild(countEl)
  }

  const openBtn = document.createElement('button')
  openBtn.className = 'ml-2 shrink-0 accent-btn text-white text-xs px-3 py-1.5 rounded-lg transition'
  openBtn.textContent = t.openTool || 'Otvori'
  openBtn.onclick = () => reopenTool(tool, data)

  textDiv.insertBefore(titleEl, textDiv.firstChild)
  card.appendChild(icon)
  card.appendChild(textDiv)
  card.appendChild(openBtn)
  wrapper.appendChild(card)
  row.appendChild(avatar)
  row.appendChild(wrapper)
  document.getElementById('chat-messages').appendChild(row)
  scrollToBottom()
  return row
}

function reopenTool(tool, data) {
  if (tool === 'flashcards' && data.cards) openFlashcardModal(data.cards)
  else if (tool === 'quiz' && data.questions) openQuizModal(data.questions)
  else if (tool === 'glossary' && data.terms) openGlossaryModal(data.terms)
  else if (tool === 'summary' && data.summary) { currentSummary = data.summary; openSummaryModal(data.summary) }
}

async function saveToolResult(tool, data) {
  if (!currentConversationId) return
  const token = getAccessToken()
  if (!token) return
  const content = JSON.stringify({ __tool__: tool, ...data })
  const msg = { role: 'assistant', content, hasPdf: false }
  currentMessages.push(msg)
  appendToolResultBubble(tool, data)
  await saveExchange([msg], token)
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

// ── Attach panel ──────────────────────────────────────────────────────────
function toggleAttachPanel() {
  const panel = document.getElementById('attach-panel')
  const isOpen = !panel.classList.contains('hidden')
  if (isOpen) {
    panel.classList.add('hidden')
  } else {
    updateAttachToolsVisibility()
    panel.classList.remove('hidden')
  }
}

function closeAttachPanel() {
  document.getElementById('attach-panel').classList.add('hidden')
}

function updateAttachToolsVisibility() {
  const section = document.getElementById('attach-tools-section')
  if (!section) return
  if (currentConversationId) {
    section.classList.remove('hidden')
  } else {
    section.classList.add('hidden')
  }
}

// ── Conv menu (3-dot) ──────────────────────────────────────────────────────
function toggleConvMenu(id, rect) {
  if (openConvMenuId && openConvMenuId !== id) closeAllConvMenus()
  const menu = document.getElementById(`conv-menu-${id}`)
  if (!menu) return
  const isOpen = !menu.classList.contains('hidden')
  if (!isOpen && rect) {
    menu.style.top = (rect.bottom + 2) + 'px'
    menu.style.left = Math.max(4, rect.right - 144) + 'px'
  }
  menu.classList.toggle('hidden', isOpen)
  openConvMenuId = isOpen ? null : id
}

function closeAllConvMenus() {
  if (openConvMenuId) {
    const menu = document.getElementById(`conv-menu-${openConvMenuId}`)
    if (menu) menu.classList.add('hidden')
    openConvMenuId = null
  }
}

function startTitleEditInline(convId) {
  const btnEl = document.querySelector(`[data-conv-title-btn="${convId}"]`)
  if (!btnEl) return
  const current = conversations.find(c => c.id === convId)?.title || ''
  const input = document.createElement('input')
  input.type = 'text'
  input.value = current
  input.maxLength = 80
  input.className = 'w-full bg-white/10 text-white text-xs rounded px-1 py-0.5 outline-none border border-white/30 focus:border-white/60'
  btnEl.textContent = ''
  btnEl.appendChild(input)

  const finish = async () => {
    const newTitle = input.value.trim() || current
    btnEl.textContent = newTitle
    if (newTitle !== current) {
      await patchConversationTitle(convId, newTitle)
      if (convId === currentConversationId) {
        document.getElementById('conversation-title').textContent = newTitle
      }
    }
  }
  input.onblur = finish
  input.onkeydown = e => {
    e.stopPropagation()
    if (e.key === 'Enter') { e.preventDefault(); input.blur() }
    if (e.key === 'Escape') { e.preventDefault(); btnEl.textContent = current }
  }
  setTimeout(() => { input.focus(); input.select() }, 10)
}

async function renameTitleAI(convId) {
  const token = getAccessToken()
  if (!token) return

  const btnEl = document.querySelector(`[data-conv-title-btn="${convId}"]`)
  const origTitle = conversations.find(c => c.id === convId)?.title || ''
  if (btnEl) btnEl.textContent = '...'

  let firstMsg
  if (convId === currentConversationId && currentMessages.length > 0) {
    firstMsg = currentMessages.find(m => m.role === 'user')?.content
  } else {
    try {
      const r = await fetch(`/api/history/${convId}`, { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const data = await r.json()
        firstMsg = data.messages.find(m => m.role === 'user')?.content
      }
    } catch {}
  }

  if (!firstMsg) { if (btnEl) btnEl.textContent = origTitle; return }

  try {
    const r = await fetch('/api/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: firstMsg, language: currentLang })
    })
    if (!r.ok) { if (btnEl) btnEl.textContent = origTitle; return }
    const { title } = await r.json()
    if (title) {
      await patchConversationTitle(convId, title)
      if (convId === currentConversationId) {
        document.getElementById('conversation-title').textContent = title
      }
    }
  } catch {
    if (btnEl) btnEl.textContent = origTitle
  }
}

function setupOutsideClick() {
  document.addEventListener('click', e => {
    const attachPanel = document.getElementById('attach-panel')
    const attachBtn = document.getElementById('attach-btn')
    const groupAttachBtn = document.getElementById('group-attach-btn')
    if (attachPanel && !attachPanel.classList.contains('hidden') &&
        !attachPanel.contains(e.target) && !attachBtn?.contains(e.target) && !groupAttachBtn?.contains(e.target)) {
      closeAttachPanel()
    }
    const avatarContainer = document.getElementById('avatar-container')
    if (avatarContainer && !avatarContainer.contains(e.target)) closeAvatarMenu()
    if (!e.target.closest('.conv-item')) closeAllConvMenus()

    const newSubjectModal = document.getElementById('new-subject-modal')
    if (newSubjectModal && !newSubjectModal.classList.contains('hidden') && e.target === newSubjectModal) closeNewSubjectModal()
    const moveSubjectModal = document.getElementById('move-subject-modal')
    if (moveSubjectModal && !moveSubjectModal.classList.contains('hidden') && e.target === moveSubjectModal) closeMoveSubjectModal()
    const notesModal = document.getElementById('notes-modal')
    if (notesModal && !notesModal.classList.contains('hidden') && e.target === notesModal) closeNotes()
  })
}

function toggleAvatarMenu() {
  document.getElementById('avatar-dropdown').classList.toggle('hidden')
}

function closeAvatarMenu() {
  document.getElementById('avatar-dropdown').classList.add('hidden')
}

// ── Continue banner ────────────────────────────────────────────────────────
function showContinueBanner() {
  const lastUser = [...currentMessages].reverse().find(m => m.role === 'user')
  if (!lastUser) return

  const snippet = lastUser.content.slice(0, 60) + (lastUser.content.length > 60 ? '...' : '')

  const banner = document.createElement('div')
  banner.className = 'fixed top-16 left-1/2 z-40 -translate-x-1/2 flex items-center gap-2 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-full shadow-md px-4 py-2 text-xs text-slate-500 dark:text-gray-400 max-w-xs'
  banner.style.transition = 'opacity 0.4s'
  banner.innerHTML = `<span>↩</span><span class="truncate">${I18N[currentLang].continueFrom}: <em>"${snippet}"</em></span>`
  document.body.appendChild(banner)

  setTimeout(() => { banner.style.opacity = '0'; setTimeout(() => banner.remove(), 400) }, 3000)
}

// ── Swipe sidebar ──────────────────────────────────────────────────────────
function setupSwipeSidebar() {
  let touchStartX = 0
  const main = document.querySelector('.flex-1.flex.flex-col')
  if (!main) return

  main.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX }, { passive: true })
  main.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX
    if (dx > 60 && touchStartX < 40) openSidebar()
    else if (dx < -60) closeSidebar()
  }, { passive: true })
}

// ── Quiz ───────────────────────────────────────────────────────────────────
async function generateQuiz() {
  if (currentMessages.length === 0) { showToast(I18N[currentLang].quizEmpty, 'info'); return }
  const token = getAccessToken()
  if (!token) return

  const attachBtn = document.getElementById('attach-btn')
  if (attachBtn) { attachBtn.textContent = '⏳'; attachBtn.disabled = true }

  try {
    const res = await fetch('/api/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: currentMessages.map(m => ({ role: m.role, content: m.content })), language: currentLang })
    })
    if (!res.ok) { showToast(I18N[currentLang].aiError, 'error'); return }
    const { questions } = await res.json()
    if (!questions || questions.length === 0) { showToast(I18N[currentLang].quizEmpty, 'info'); return }
    openQuizModal(questions)
    saveToolResult('quiz', { questions })
  } catch { showToast(I18N[currentLang].aiError, 'error') }
  finally { if (attachBtn) { attachBtn.textContent = '＋'; attachBtn.disabled = false } }
}

function openQuizModal(questions) {
  quizQuestions = questions
  quizIndex = 0
  quizScore = 0
  quizAnswered = false
  document.getElementById('quiz-result-screen').classList.add('hidden')
  document.getElementById('quiz-question-screen').classList.remove('hidden')
  document.getElementById('quiz-modal').classList.remove('hidden')
  renderQuizQuestion()
}

function closeQuizModal() {
  document.getElementById('quiz-modal').classList.add('hidden')
}

function renderQuizQuestion() {
  const q = quizQuestions[quizIndex]
  const t = I18N[currentLang]
  quizAnswered = false

  document.getElementById('quiz-progress-label').textContent = `${quizIndex + 1} / ${quizQuestions.length}`
  document.getElementById('quiz-progress-bar').style.width = `${((quizIndex) / quizQuestions.length) * 100}%`
  document.getElementById('quiz-question').textContent = q.q

  const explanationEl = document.getElementById('quiz-explanation')
  explanationEl.classList.add('hidden')
  explanationEl.textContent = ''

  const nextBtn = document.getElementById('quiz-next-btn')
  nextBtn.classList.add('hidden')
  nextBtn.textContent = quizIndex < quizQuestions.length - 1 ? t.quizNext : t.quizFinish

  const optionsEl = document.getElementById('quiz-options')
  optionsEl.innerHTML = ''
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button')
    btn.className = 'quiz-option'
    btn.textContent = opt
    btn.onclick = () => handleQuizAnswer(i)
    optionsEl.appendChild(btn)
  })
}

function handleQuizAnswer(chosenIdx) {
  if (quizAnswered) return
  quizAnswered = true

  const q = quizQuestions[quizIndex]
  const t = I18N[currentLang]
  const optionBtns = document.querySelectorAll('.quiz-option')

  optionBtns.forEach(btn => btn.disabled = true)
  optionBtns[q.correct].classList.add('correct')

  if (chosenIdx === q.correct) {
    quizScore++
  } else {
    optionBtns[chosenIdx].classList.add('wrong')
  }

  const explanationEl = document.getElementById('quiz-explanation')
  const isCorrect = chosenIdx === q.correct
  explanationEl.className = `mt-3 p-3 rounded-lg text-xs leading-relaxed border ${isCorrect ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'}`
  explanationEl.textContent = `${isCorrect ? t.quizCorrect : t.quizWrong} ${q.explanation}`
  explanationEl.classList.remove('hidden')

  document.getElementById('quiz-next-btn').classList.remove('hidden')
}

function quizNext() {
  quizIndex++
  if (quizIndex >= quizQuestions.length) {
    showQuizResult()
  } else {
    renderQuizQuestion()
  }
}

function showQuizResult() {
  const t = I18N[currentLang]
  const total = quizQuestions.length
  const pct = Math.round((quizScore / total) * 100)

  document.getElementById('quiz-question-screen').classList.add('hidden')
  document.getElementById('quiz-result-screen').classList.remove('hidden')
  document.getElementById('quiz-progress-bar').style.width = '100%'

  const emoji = pct >= 80 ? '🎉' : pct >= 60 ? '👍' : '📚'
  document.getElementById('quiz-result-emoji').textContent = emoji
  document.getElementById('quiz-score-text').textContent = `${quizScore} / ${total}`
  document.getElementById('quiz-score-sub').textContent = `${pct}%`
}

function restartQuiz() {
  quizIndex = 0
  quizScore = 0
  quizAnswered = false
  document.getElementById('quiz-result-screen').classList.add('hidden')
  document.getElementById('quiz-question-screen').classList.remove('hidden')
  renderQuizQuestion()
}

// ── Glossary ───────────────────────────────────────────────────────────────
async function generateGlossary() {
  if (currentMessages.length === 0) { showToast(I18N[currentLang].glossaryEmpty, 'info'); return }
  const token = getAccessToken()
  if (!token) return

  const attachBtn = document.getElementById('attach-btn')
  if (attachBtn) { attachBtn.textContent = '⏳'; attachBtn.disabled = true }

  try {
    const res = await fetch('/api/glossary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: currentMessages.map(m => ({ role: m.role, content: m.content })), language: currentLang })
    })
    if (!res.ok) { showToast(I18N[currentLang].aiError, 'error'); return }
    const { terms } = await res.json()
    if (!terms || terms.length === 0) { showToast(I18N[currentLang].glossaryEmpty, 'info'); return }
    openGlossaryModal(terms)
    saveToolResult('glossary', { terms })
  } catch { showToast(I18N[currentLang].aiError, 'error') }
  finally { if (attachBtn) { attachBtn.textContent = '＋'; attachBtn.disabled = false } }
}

function openGlossaryModal(terms) {
  const list = document.getElementById('glossary-list')
  list.innerHTML = ''
  terms.forEach(({ term, definition }) => {
    const card = document.createElement('div')
    card.className = 'rounded-xl border border-slate-100 dark:border-gray-700 p-3'
    card.innerHTML = `<p class="text-sm font-semibold text-slate-800 dark:text-gray-100 mb-1">${term}</p><p class="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">${definition}</p>`
    list.appendChild(card)
  })
  document.getElementById('glossary-modal').classList.remove('hidden')
}

function closeGlossaryModal() {
  document.getElementById('glossary-modal').classList.add('hidden')
}

// ── Summary ────────────────────────────────────────────────────────────────
async function generateSummary() {
  if (currentMessages.length === 0) { showToast(I18N[currentLang].summaryEmpty, 'info'); return }
  const token = getAccessToken()
  if (!token) return

  const attachBtn = document.getElementById('attach-btn')
  if (attachBtn) { attachBtn.textContent = '⏳'; attachBtn.disabled = true }

  try {
    const res = await fetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: currentMessages.map(m => ({ role: m.role, content: m.content })), language: currentLang })
    })
    if (!res.ok) { showToast(I18N[currentLang].aiError, 'error'); return }
    const { summary } = await res.json()
    if (!summary) { showToast(I18N[currentLang].summaryEmpty, 'info'); return }
    currentSummary = summary
    openSummaryModal(summary)
    saveToolResult('summary', { summary })
  } catch { showToast(I18N[currentLang].aiError, 'error') }
  finally { if (attachBtn) { attachBtn.textContent = '＋'; attachBtn.disabled = false } }
}

function openSummaryModal(summary) {
  const t = I18N[currentLang]
  const el = document.getElementById('summary-content')

  let html = `<h3 class="text-base font-bold text-slate-800 dark:text-gray-100 mb-4">${summary.title || ''}</h3>`

  if (summary.keyPoints?.length) {
    html += `<div class="mb-4"><p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-2">${t.summaryKeyPoints}</p><ul class="flex flex-col gap-1.5">`
    summary.keyPoints.forEach(p => {
      html += `<li class="flex gap-2 text-sm text-slate-700 dark:text-gray-200"><span class="text-slate-300 dark:text-gray-600 shrink-0 mt-0.5">•</span>${p}</li>`
    })
    html += '</ul></div>'
  }

  if (summary.formulas?.length) {
    html += `<div class="mb-4"><p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-2">${t.summaryFormulas}</p><div class="flex flex-col gap-1.5">`
    summary.formulas.forEach(f => {
      html += `<div class="font-mono text-sm bg-slate-50 dark:bg-gray-700 border border-slate-100 dark:border-gray-600 rounded-lg px-3 py-1.5 text-slate-800 dark:text-gray-100">${f}</div>`
    })
    html += '</div></div>'
  }

  if (summary.toRemember?.length) {
    html += `<div><p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-2">${t.summaryToRemember}</p><ul class="flex flex-col gap-1.5">`
    summary.toRemember.forEach(r => {
      html += `<li class="flex gap-2 text-sm text-slate-700 dark:text-gray-200"><span style="color:var(--ac)" class="shrink-0 font-bold mt-0.5">★</span>${r}</li>`
    })
    html += '</ul></div>'
  }

  el.innerHTML = html
  document.getElementById('summary-modal').classList.remove('hidden')
}

function closeSummaryModal() {
  document.getElementById('summary-modal').classList.add('hidden')
}

function printSummary() {
  if (!currentSummary) return
  const t = I18N[currentLang]
  const title = document.getElementById('conversation-title').textContent
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title} — ${t.summaryTitle}</title>
<style>body{font-family:Inter,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#1e293b}
h1{font-size:18px;font-weight:700;color:#1F4E79;margin-bottom:24px}h2{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin:20px 0 8px}
ul{padding-left:0;list-style:none}li{font-size:14px;line-height:1.65;margin-bottom:6px;display:flex;gap:8px}
.formula{font-family:monospace;font-size:13px;background:#f1f5f9;padding:8px 12px;border-radius:6px;margin-bottom:6px}
</style></head><body>
<h1>📚 ${currentSummary.title || title}</h1>`

  if (currentSummary.keyPoints?.length) {
    html += `<h2>${t.summaryKeyPoints}</h2><ul>${currentSummary.keyPoints.map(p => `<li><span>•</span>${p}</li>`).join('')}</ul>`
  }
  if (currentSummary.formulas?.length) {
    html += `<h2>${t.summaryFormulas}</h2>${currentSummary.formulas.map(f => `<div class="formula">${f}</div>`).join('')}`
  }
  if (currentSummary.toRemember?.length) {
    html += `<h2>${t.summaryToRemember}</h2><ul>${currentSummary.toRemember.map(r => `<li><span>★</span>${r}</li>`).join('')}</ul>`
  }

  html += '</body></html>'
  const win = window.open('', '_blank')
  if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 400) }
}

// ── Settings modal ─────────────────────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden')
  updateThemeButtons()
  updateColorSwatches()
  updateLanguageButtons()
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden')
}

function closeSettingsOnOverlay(e) {
  if (e.target === e.currentTarget) closeSettings()
}

function updateThemeButtons() {
  const theme = getCurrentTheme()
  const inactiveClass = 'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition bg-white dark:bg-gray-700 text-slate-600 dark:text-gray-300 border-slate-200 dark:border-gray-600'
  const lightBtn = document.getElementById('theme-light-btn')
  const darkBtn = document.getElementById('theme-dark-btn')

  lightBtn.className = inactiveClass
  darkBtn.className = inactiveClass

  if (theme === 'light') {
    lightBtn.style.backgroundColor = 'var(--ac)'
    lightBtn.style.color = 'white'
    lightBtn.style.borderColor = 'var(--ac)'
    darkBtn.style.backgroundColor = ''
    darkBtn.style.color = ''
    darkBtn.style.borderColor = ''
  } else {
    darkBtn.style.backgroundColor = 'var(--ac)'
    darkBtn.style.color = 'white'
    darkBtn.style.borderColor = 'var(--ac)'
    lightBtn.style.backgroundColor = ''
    lightBtn.style.color = ''
    lightBtn.style.borderColor = ''
  }
}

// ── Subjects (localStorage) ────────────────────────────────────────────────
function getSubjectMap() {
  try { return JSON.parse(localStorage.getItem('sb-subject-map') || '{}') } catch { return {} }
}

function saveSubjectMap(map) {
  localStorage.setItem('sb-subject-map', JSON.stringify(map))
}

function getSubjectNames() {
  const fromMap = new Set(Object.values(getSubjectMap()))
  let manual = []
  try { manual = JSON.parse(localStorage.getItem('sb-subjects') || '[]') } catch {}
  manual.forEach(s => fromMap.add(s))
  return [...fromMap].sort()
}

function renderSubjectsList() {
  const list = document.getElementById('subjects-list')
  if (!list) return
  const subjects = getSubjectNames()
  const t = I18N[currentLang]
  list.innerHTML = ''

  if (subjects.length === 0) return

  const allBtn = document.createElement('button')
  allBtn.className = `text-[10px] px-2 py-0.5 rounded-full font-semibold transition ${!currentSubjectFilter ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80 bg-white/5'}`
  allBtn.textContent = t.allConversations
  allBtn.onclick = () => { currentSubjectFilter = null; renderSubjectsList(); renderConversationList() }
  list.appendChild(allBtn)

  subjects.forEach(name => {
    const btn = document.createElement('button')
    btn.className = `text-[10px] px-2 py-0.5 rounded-full font-semibold transition ${currentSubjectFilter === name ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80 bg-white/5'}`
    btn.textContent = name
    btn.onclick = () => {
      currentSubjectFilter = currentSubjectFilter === name ? null : name
      renderSubjectsList()
      renderConversationList()
    }
    list.appendChild(btn)
  })
}

function openNewSubjectModal() {
  document.getElementById('new-subject-modal').classList.remove('hidden')
  setTimeout(() => document.getElementById('new-subject-input')?.focus(), 50)
}

function closeNewSubjectModal() {
  document.getElementById('new-subject-modal').classList.add('hidden')
  document.getElementById('new-subject-input').value = ''
}

function saveNewSubject() {
  const input = document.getElementById('new-subject-input')
  const name = input.value.trim()
  if (!name) { input.focus(); return }
  let existing = []
  try { existing = JSON.parse(localStorage.getItem('sb-subjects') || '[]') } catch {}
  if (!existing.includes(name)) {
    existing.push(name)
    localStorage.setItem('sb-subjects', JSON.stringify(existing))
  }
  closeNewSubjectModal()
  renderSubjectsList()
}

function openMoveSubjectModal(convId) {
  const modal = document.getElementById('move-subject-modal')
  const pickList = document.getElementById('subject-pick-list')
  pickList.innerHTML = ''
  const t = I18N[currentLang]
  const subjects = getSubjectNames()
  const map = getSubjectMap()
  const current = map[convId]

  const noneBtn = document.createElement('button')
  noneBtn.className = `w-full text-left px-3 py-2 text-sm rounded-lg transition ${!current ? 'text-slate-800 dark:text-gray-100 font-semibold bg-slate-50 dark:bg-gray-700' : 'text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700'}`
  noneBtn.textContent = '— ' + t.noSubject
  noneBtn.onclick = () => { delete map[convId]; saveSubjectMap(map); closeMoveSubjectModal(); renderSubjectsList(); renderConversationList() }
  pickList.appendChild(noneBtn)

  subjects.forEach(name => {
    const btn = document.createElement('button')
    btn.className = `w-full text-left px-3 py-2 text-sm rounded-lg transition ${current === name ? 'text-slate-800 dark:text-gray-100 font-semibold bg-slate-50 dark:bg-gray-700' : 'text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700'}`
    btn.textContent = (current === name ? '✓ ' : '') + name
    btn.onclick = () => {
      map[convId] = name
      saveSubjectMap(map)
      closeMoveSubjectModal()
      renderSubjectsList()
      renderConversationList()
    }
    pickList.appendChild(btn)
  })

  if (subjects.length === 0) {
    pickList.innerHTML = `<p class="text-xs text-slate-400 dark:text-gray-500 text-center py-3">${t.newSubjectBtn}</p>`
  }

  modal.classList.remove('hidden')
}

function closeMoveSubjectModal() {
  document.getElementById('move-subject-modal').classList.add('hidden')
}

// ── Notes (Supabase) ────────────────────────────────────────────────────────
async function loadNotes() {
  const token = getAccessToken()
  if (!token) return
  const res = await fetch('/api/notes', { headers: { Authorization: `Bearer ${token}` } })
  if (res.ok) notesCache = await res.json()
}

async function openNotes() {
  document.getElementById('notes-modal').classList.remove('hidden')
  await loadNotes()
  notesShowList()
}

function closeNotes() {
  document.getElementById('notes-modal').classList.add('hidden')
  if (noteSaveTimer) { clearTimeout(noteSaveTimer); noteSaveTimer = null; doSaveNote() }
}

function notesShowList() {
  document.getElementById('notes-list-view').classList.remove('hidden')
  document.getElementById('note-edit-view').classList.add('hidden')
  document.getElementById('notes-back-btn').classList.add('hidden')
  document.getElementById('notes-new-btn').classList.remove('hidden')
  currentNoteId = null
  renderNotesList()
}

function renderNotesList() {
  const cards = document.getElementById('notes-cards')
  const empty = document.getElementById('notes-empty')
  cards.innerHTML = ''

  if (notesCache.length === 0) {
    empty.classList.remove('hidden')
    return
  }
  empty.classList.add('hidden')

  notesCache.forEach(note => {
    const card = document.createElement('div')
    card.className = 'note-card relative bg-slate-50 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 rounded-xl p-3'
    const preview = (note.content || '').split('\n').slice(0, 3).join('\n')
    card.innerHTML = `
      <p class="text-xs font-semibold text-slate-800 dark:text-gray-100 mb-1 truncate">${note.title || (I18N[currentLang].newNote)}</p>
      <p class="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed line-clamp-3 whitespace-pre-wrap">${preview}</p>
      <button class="note-delete absolute top-2 right-2 text-slate-300 dark:text-gray-600 hover:text-red-400 text-sm leading-none" onclick="event.stopPropagation();deleteNote('${note.id}')">×</button>
    `
    card.onclick = () => notesOpenEdit(note.id)
    cards.appendChild(card)
  })
}

function notesOpenEdit(id) {
  const note = notesCache.find(n => n.id === id)
  if (!note) return
  currentNoteId = id
  document.getElementById('note-title-input').value = note.title || ''
  document.getElementById('note-content-input').value = note.content || ''
  document.getElementById('notes-list-view').classList.add('hidden')
  document.getElementById('note-edit-view').classList.remove('hidden')
  document.getElementById('notes-back-btn').classList.remove('hidden')
  document.getElementById('notes-new-btn').classList.add('hidden')
  document.getElementById('note-content-input').focus()
}

async function createNewNote() {
  const token = getAccessToken()
  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: '', content: '' })
  })
  if (!res.ok) return
  const note = await res.json()
  notesCache.unshift(note)
  notesOpenEdit(note.id)
}

async function deleteNote(id) {
  const token = getAccessToken()
  await fetch(`/api/notes/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  notesCache = notesCache.filter(n => n.id !== id)
  if (currentNoteId === id) notesShowList()
  else renderNotesList()
}

function scheduleNoteSave() {
  if (noteSaveTimer) clearTimeout(noteSaveTimer)
  noteSaveTimer = setTimeout(doSaveNote, 800)
}

async function doSaveNote() {
  if (!currentNoteId) return
  const title = document.getElementById('note-title-input').value
  const content = document.getElementById('note-content-input').value
  const token = getAccessToken()
  const res = await fetch(`/api/notes/${currentNoteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, content })
  })
  if (res.ok) {
    const updated = await res.json()
    const idx = notesCache.findIndex(n => n.id === currentNoteId)
    if (idx >= 0) notesCache[idx] = updated
  }
  noteSaveTimer = null
}

// ── Share conversation ─────────────────────────────────────────────────────
async function shareConversation() {
  if (!currentConversationId) return
  const token = getAccessToken()
  const res = await fetch(`/api/conversations/${currentConversationId}/share`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) { showToast(I18N[currentLang].aiError, 'error'); return }
  const { token: shareToken } = await res.json()
  const link = `${location.origin}/share.html?t=${shareToken}`
  document.getElementById('share-link-input').value = link
  document.getElementById('share-modal').classList.remove('hidden')
}

function closeShareModal() {
  document.getElementById('share-modal').classList.add('hidden')
}

function copyShareLink() {
  const input = document.getElementById('share-link-input')
  navigator.clipboard.writeText(input.value).then(() => {
    showToast(I18N[currentLang].linkCopied, 'success')
  }).catch(() => {
    input.select()
    document.execCommand('copy')
    showToast(I18N[currentLang].linkCopied, 'success')
  })
}

async function revokeShare() {
  if (!currentConversationId) return
  const token = getAccessToken()
  const res = await fetch(`/api/conversations/${currentConversationId}/share`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    closeShareModal()
    showToast(I18N[currentLang].deleteSuccess, 'success')
  }
}

// ── Study groups ───────────────────────────────────────────────────────────
async function loadGroups() {
  const token = getAccessToken()
  if (!token) return
  const res = await fetch('/api/groups', { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return
  groupsList = await res.json()
  renderGroupsList()
}

function renderGroupsList() {
  const list = document.getElementById('groups-list')
  if (!list) return
  const t = I18N[currentLang]
  if (groupsList.length === 0) {
    list.innerHTML = `<p class="text-xs text-slate-400 dark:text-gray-500 px-2 py-1">${t.noGroups}</p>`
    return
  }
  list.innerHTML = groupsList.map(g => `
    <button onclick="openGroup('${g.id}')"
      class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-100 dark:hover:bg-gray-700 transition text-slate-700 dark:text-gray-200 truncate flex items-center gap-2">
      <span class="text-base">👥</span>
      <span class="truncate">${g.name}</span>
    </button>
  `).join('')
}

function openCreateGroupModal() {
  document.getElementById('group-name-input').value = ''
  document.getElementById('create-group-modal').classList.remove('hidden')
  document.getElementById('group-name-input').focus()
}

function closeCreateGroupModal() {
  document.getElementById('create-group-modal').classList.add('hidden')
}

async function createGroup() {
  const name = document.getElementById('group-name-input').value.trim()
  if (!name) return
  const token = getAccessToken()
  const res = await fetch('/api/groups', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  })
  if (!res.ok) { showToast(I18N[currentLang].aiError, 'error'); return }
  const group = await res.json()
  groupsList.unshift(group)
  renderGroupsList()
  closeCreateGroupModal()
  openGroup(group.id)
}

async function openGroup(id) {
  currentGroupId = id
  const token = getAccessToken()
  const res = await fetch(`/api/groups/${id}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return
  const group = await res.json()
  currentGroupData = group

  document.getElementById('conversation-title').textContent = group.name
  document.getElementById('chat-messages').classList.add('hidden')
  document.getElementById('group-messages').classList.remove('hidden')
  document.getElementById('main-input-bar').classList.add('hidden')
  document.getElementById('group-input-bar').classList.remove('hidden')
  attachedFiles = []
  renderAttachedFilesBar()
  document.getElementById('back-to-chat-btn').classList.remove('hidden')
  document.getElementById('group-header-actions').classList.remove('hidden')

  await loadGroupMessages()
  subscribeToGroup(id)
}

function closeGroupView() {
  unsubscribeFromGroup()
  currentGroupId = null
  currentGroupData = null
  document.getElementById('chat-messages').classList.remove('hidden')
  document.getElementById('group-messages').classList.add('hidden')
  document.getElementById('main-input-bar').classList.remove('hidden')
  document.getElementById('group-input-bar').classList.add('hidden')
  document.getElementById('back-to-chat-btn').classList.add('hidden')
  document.getElementById('group-header-actions').classList.add('hidden')
  document.getElementById('conversation-title').textContent = currentConversationId
    ? (conversations.find(c => c.id === currentConversationId)?.title || I18N[currentLang].newChat)
    : I18N[currentLang].newChat
}

async function loadGroupMessages() {
  const token = getAccessToken()
  const res = await fetch(`/api/groups/${currentGroupId}/messages`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) return
  const messages = await res.json()
  const container = document.getElementById('group-messages')
  container.innerHTML = ''
  messages.forEach(m => renderGroupMessage(m, container))
  container.scrollTop = container.scrollHeight
}

function renderGroupMessage(msg, container) {
  const el = document.createElement('div')
  const isAI = msg.is_ai
  const isOwn = !isAI && currentUserId && msg.user_id === currentUserId
  const name = msg.display_name || (isAI ? 'StudyBuddy' : 'Student')
  el.className = `flex flex-col ${isOwn ? 'items-end' : 'items-start'} mb-3`
  el.innerHTML = `
    <span class="text-[10px] text-slate-400 dark:text-gray-500 mb-0.5 px-1">${isAI ? '🤖 ' : ''}${name}</span>
    <div class="max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
      isAI
        ? 'bg-slate-100 dark:bg-gray-700 text-slate-800 dark:text-gray-100'
        : isOwn
          ? 'bg-[var(--ac)] text-white'
          : 'bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-600 text-slate-800 dark:text-gray-100'
    }">${msg.content.replace(/\n/g, '<br>')}</div>
  `
  if (container) container.appendChild(el)
  else document.getElementById('group-messages').appendChild(el)
}

async function sendGroupMessage() {
  const input = document.getElementById('group-input')
  const content = input.value.trim()
  if (!content || !currentGroupId) return
  input.value = ''
  const token = getAccessToken()
  const res = await fetch(`/api/groups/${currentGroupId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, displayName: currentDisplayName || null })
  })
  if (!res.ok) { showToast(I18N[currentLang].aiError, 'error'); return }
  const { message } = await res.json()
  if (currentUserId) message.user_id = currentUserId
  renderGroupMessage(message)
  const container = document.getElementById('group-messages')
  container.scrollTop = container.scrollHeight
}

function handleGroupInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendGroupMessage()
  }
}

function openInviteModal(groupId) {
  document.getElementById('invite-email-input').value = ''
  document.getElementById('invite-error').textContent = ''
  document.getElementById('invite-modal').setAttribute('data-group-id', groupId || currentGroupId)
  document.getElementById('invite-modal').classList.remove('hidden')
  document.getElementById('invite-email-input').focus()
}

function closeInviteModal() {
  document.getElementById('invite-modal').classList.add('hidden')
}

async function inviteMember() {
  const email = document.getElementById('invite-email-input').value.trim()
  if (!email) return
  const groupId = document.getElementById('invite-modal').getAttribute('data-group-id')
  const btn = document.getElementById('invite-btn')
  const errEl = document.getElementById('invite-error')
  btn.disabled = true
  btn.textContent = I18N[currentLang].inviteSending
  errEl.textContent = ''
  errEl.classList.add('hidden')
  const token = getAccessToken()
  const res = await fetch(`/api/groups/${groupId}/invite`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  })
  btn.disabled = false
  btn.textContent = I18N[currentLang].inviteBtn
  if (res.ok) {
    showToast(I18N[currentLang].inviteSuccess, 'success')
    closeInviteModal()
  } else {
    const data = await res.json()
    errEl.classList.remove('hidden')
    if (data.error === 'user_not_found') errEl.textContent = I18N[currentLang].userNotFound
    else if (data.error === 'already_member') errEl.textContent = I18N[currentLang].alreadyMember
    else errEl.textContent = I18N[currentLang].aiError
  }
}

async function openGroupInfo() {
  if (!currentGroupId) return
  const group = currentGroupData
  if (!group) return
  document.getElementById('group-info-title').textContent = group.name
  const membersList = document.getElementById('group-info-members')
  membersList.innerHTML = (group.members || []).map(m => `
    <div class="flex items-center gap-2 py-1">
      <div class="w-7 h-7 rounded-full bg-[var(--ac)] flex items-center justify-center text-white text-xs font-bold">
        ${(m.display_name || m.email || '?')[0].toUpperCase()}
      </div>
      <span class="text-sm text-slate-700 dark:text-gray-200">${m.display_name || m.email}</span>
    </div>
  `).join('')
  document.getElementById('group-info-modal').classList.remove('hidden')
}

function closeGroupInfoModal() {
  document.getElementById('group-info-modal').classList.add('hidden')
}

async function leaveGroup() {
  if (!currentGroupId) return
  const token = getAccessToken()
  await fetch(`/api/groups/${currentGroupId}/leave`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  })
  groupsList = groupsList.filter(g => g.id !== currentGroupId)
  renderGroupsList()
  closeGroupInfoModal()
  closeGroupView()
  showToast(I18N[currentLang].deleteSuccess, 'success')
}

function subscribeToGroup(groupId) {
  if (!sb) return
  unsubscribeFromGroup()
  groupRealtimeChannel = sb
    .channel(`group-messages-${groupId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'group_messages',
      filter: `group_id=eq.${groupId}`
    }, (payload) => {
      if (currentUserId && payload.new.user_id === currentUserId && !payload.new.is_ai) return
      renderGroupMessage(payload.new)
      const container = document.getElementById('group-messages')
      if (container) container.scrollTop = container.scrollHeight
    })
    .subscribe()
}

function unsubscribeFromGroup() {
  if (groupRealtimeChannel) {
    groupRealtimeChannel.unsubscribe()
    groupRealtimeChannel = null
  }
}

// ── File Library ───────────────────────────────────────────────────────────
async function openLibrary() {
  document.getElementById('library-modal').classList.remove('hidden')
  closeSidebar()
  await refreshLibrary()
}

function closeLibrary() {
  document.getElementById('library-modal').classList.add('hidden')
}

async function refreshLibrary() {
  const token = getAccessToken()
  if (!token) return
  const grid = document.getElementById('library-grid')
  const empty = document.getElementById('library-empty')
  const loadingP = document.createElement('p')
  loadingP.className = 'text-xs text-slate-400 col-span-2 py-4 text-center'
  loadingP.textContent = I18N[currentLang].libraryLoading
  grid.innerHTML = ''
  grid.appendChild(loadingP)

  try {
    const res = await fetch('/api/files', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { grid.innerHTML = ''; return }
    const files = await res.json()

    grid.innerHTML = ''
    if (!files.length) {
      empty.classList.remove('hidden')
      return
    }
    empty.classList.add('hidden')

    files.forEach(f => {
      const sizeKB = (f.size / 1024).toFixed(0)
      const date = new Date(f.created_at).toLocaleDateString('sr-Latn-RS')
      const icon = f.mime_type === 'application/pdf' ? '📄' : '🖼️'

      const card = document.createElement('div')
      card.className = 'flex items-start gap-3 bg-slate-50 dark:bg-gray-750 rounded-xl p-3 border border-slate-100 dark:border-gray-700'

      const iconSpan = document.createElement('span')
      iconSpan.className = 'text-2xl flex-shrink-0'
      iconSpan.textContent = icon

      const info = document.createElement('div')
      info.className = 'flex-1 min-w-0'

      const nameP = document.createElement('p')
      nameP.className = 'text-sm font-medium text-slate-800 dark:text-white truncate'
      nameP.title = f.name
      nameP.textContent = f.name

      const metaP = document.createElement('p')
      metaP.className = 'text-xs text-slate-400 dark:text-gray-500 mt-0.5'
      metaP.textContent = `${sizeKB} KB · ${date}`

      const btnRow = document.createElement('div')
      btnRow.className = 'flex gap-2 mt-2 flex-wrap'

      const previewBtn = document.createElement('button')
      previewBtn.className = 'text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 transition'
      previewBtn.textContent = I18N[currentLang].libraryPreview
      previewBtn.addEventListener('click', () => previewLibraryFile(f.id))

      const downloadBtn = document.createElement('button')
      downloadBtn.className = 'text-xs bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-300 px-2 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-gray-600 transition'
      downloadBtn.textContent = I18N[currentLang].libraryDownload
      downloadBtn.addEventListener('click', () => downloadLibraryFile(f.id, f.name))

      const attachBtn = document.createElement('button')
      attachBtn.className = 'text-xs bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-2 py-0.5 rounded hover:bg-green-100 dark:hover:bg-green-900/50 transition'
      attachBtn.textContent = I18N[currentLang].libraryAttach
      attachBtn.addEventListener('click', () => attachLibraryFile(f.id, f.name, f.mime_type, f.size))

      const deleteBtn = document.createElement('button')
      deleteBtn.className = 'text-xs bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 px-2 py-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition'
      deleteBtn.textContent = I18N[currentLang].libraryDelete
      deleteBtn.addEventListener('click', () => deleteLibraryFile(f.id))

      btnRow.append(previewBtn, downloadBtn, attachBtn, deleteBtn)
      info.append(nameP, metaP, btnRow)
      card.append(iconSpan, info)
      grid.appendChild(card)
    })
  } catch {
    grid.innerHTML = ''
  }
}

async function previewLibraryFile(id) {
  const token = getAccessToken()
  if (!token) return
  try {
    const res = await fetch(`/api/files/${id}/url`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const { signedUrl } = await res.json()
    window.open(signedUrl, '_blank')
  } catch {}
}

async function downloadLibraryFile(id, name) {
  const token = getAccessToken()
  if (!token) return
  try {
    const res = await fetch(`/api/files/${id}/url`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const { signedUrl } = await res.json()
    const a = document.createElement('a')
    a.href = signedUrl
    a.download = name
    a.click()
  } catch {}
}

async function attachLibraryFile(id, name, mimeType, size) {
  const token = getAccessToken()
  if (!token) return
  try {
    const urlRes = await fetch(`/api/files/${id}/url`, { headers: { Authorization: `Bearer ${token}` } })
    if (!urlRes.ok) return
    const { signedUrl } = await urlRes.json()
    attachedFiles.push({ id, name, mime_type: mimeType, size, signedUrl, base64: null })
    renderAttachedFilesBar()
    closeLibrary()
    showToast(I18N[currentLang].fileAttached, 'success')
  } catch { showToast(I18N[currentLang].fileAttachError, 'error') }
}

async function deleteLibraryFile(id) {
  const token = getAccessToken()
  if (!token) return
  try {
    const res = await fetch(`/api/files/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) { showToast(I18N[currentLang].fileDeleteError, 'error'); return }
    attachedFiles = attachedFiles.filter(f => f.id !== id)
    renderAttachedFilesBar()
    showToast(I18N[currentLang].fileDeleted, 'success')
    await refreshLibrary()
  } catch { showToast(I18N[currentLang].fileDeleteError, 'error') }
}
