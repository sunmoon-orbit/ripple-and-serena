let release = null
let revision = 0
export function bindAgentSession(cleanup) { release?.(); release = cleanup; return () => { if (release === cleanup) release = null } }
export function invalidateAgent() { revision++; const cleanup = release; release = null; cleanup?.() }
export const agentRevision = () => revision
export const canAuthenticate = config => config?.enabled === true && typeof config.apiToken === 'string' && !!config.apiToken.trim()
export function settingsRoute() { return { panel: 'settings', intent: 'moon-settings' } }
