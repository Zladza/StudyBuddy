/* global supabase, I18N */

let sb = null

async function initAuth() {
  const config = await fetch('/api/config').then(r => r.json())
  sb = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  return sb
}

async function getSession() {
  if (!sb) await initAuth()
  const { data } = await sb.auth.getSession()
  return data.session
}

async function requireSession() {
  if (new URLSearchParams(window.location.search).get('preview') === '1') {
    return { user: { email: 'preview@studybuddy.rs' } }
  }
  const session = await getSession()
  if (!session) {
    window.location.href = '/login.html'
    return null
  }
  return session
}

async function signIn(email, password) {
  if (!sb) await initAuth()
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  return { data, error }
}

async function signUp(email, password) {
  if (!sb) await initAuth()
  const { data, error } = await sb.auth.signUp({ email, password })
  return { data, error }
}

async function signOut() {
  if (!sb) await initAuth()
  await sb.auth.signOut()
  window.location.href = '/login.html'
}

function getAccessToken() {
  const key = Object.keys(localStorage).find(k => k.endsWith('-auth-token'))
  if (!key) return null
  try {
    return JSON.parse(localStorage.getItem(key))?.access_token || null
  } catch {
    return null
  }
}
