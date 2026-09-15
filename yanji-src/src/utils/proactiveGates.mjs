export const contactEnabled = value => value === true || value === 'true' || value === 1 || value === '1'
let revision = 0
export const invalidateContacts = () => { revision++ }
export function createContactGuard(read, state, kind = 'message') {
  const localRevision = revision
  let serverRevision
  const current = () => revision === localRevision && contactAllowed(state(), kind)
  return {
    current,
    async check() {
      if (!current()) return false
      try {
        const config = await read()
        if (!current() || config?.[kind === 'call' ? 'callsEnabled' : 'messagesEnabled'] !== true || !Number.isSafeInteger(config.revision)) return false
        if (serverRevision === undefined) serverRevision = config.revision
        return serverRevision === config.revision
      } catch { return false }
    },
  }
}
export function contactAllowed(state, kind) { return contactEnabled(kind === 'call' ? state.proactiveCall : state.longingPush) }
export function syncContactFields(state) {
  return { timeAwareness: contactEnabled(state.timeAwareness), longingPush: contactAllowed(state, 'message'), proactiveCalls: contactAllowed(state, 'call') }
}
export function createSettingsWriter(send) {
  let version = 0, pending = Promise.resolve()
  return value => {
    const mine = ++version
    pending = pending.catch(() => {}).then(() => mine === version ? send(value) : undefined)
    return pending
  }
}
