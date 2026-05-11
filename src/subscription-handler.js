const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')

function makeSubscriptionHandler(supabaseClient) {
  const db = supabaseClient || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  function verifySignature(rawBody, signature) {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET
    if (!secret || !signature) return false
    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    try {
      return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signature, 'hex'))
    } catch {
      return false
    }
  }

  async function setUserPlan(userId, plan, subscriptionId) {
    await db.from('profiles').upsert({ id: userId, plan, ls_subscription_id: subscriptionId })
  }

  async function handleWebhook(req, res) {
    const signature = req.headers['x-signature']
    if (!signature) return res.status(401).json({ error: 'Missing signature' })

    const rawBody = req.body
    if (!verifySignature(rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid signature' })
    }

    const payload = JSON.parse(rawBody.toString())
    const eventName = payload.meta?.event_name
    const userId = payload.meta?.custom_data?.user_id
    const subscriptionId = payload.data?.id

    if (!userId) return res.sendStatus(200)

    switch (eventName) {
      case 'subscription_created':
      case 'subscription_resumed':
        await setUserPlan(userId, 'pro', subscriptionId)
        break
      case 'subscription_expired':
        await setUserPlan(userId, 'free', null)
        break
    }

    res.sendStatus(200)
  }

  return { handleWebhook }
}

module.exports = { makeSubscriptionHandler }
