// 情绪快照同步：把本地情绪状态（含 lastSeen）报给 moon-memory /emotion/sync，
// 供服务端思念推送 cron（离开太久时 API 涟言决定要不要推一条）离线读取。
// fire-and-forget + 节流，失败静默——同步挂了不该打扰聊天。
import { getEmotionState } from './emotion'
import { syncEmotion } from '../api/moonMemory'

let lastSyncAt = 0
const THROTTLE_MS = 5 * 60 * 1000

export function maybeSyncEmotion(moonMemory, { timeAwareness, longingPush, proactiveCall }, force = false) {
  if (!moonMemory?.apiToken) return
  const baseUrl = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
  // 新壳同时持久化 token 所属的 HTTPS 后端；旧壳继续沿用只同步 token 的桥。
  try {
    if (window.YanjiNative?.saveMoonConnection) {
      window.YanjiNative.saveMoonConnection(baseUrl, moonMemory.apiToken)
    } else {
      window.YanjiNative?.saveMoonToken?.(moonMemory.apiToken)
    }
  } catch { /* 忽略 */ }
  if (!force && Date.now() - lastSyncAt < THROTTLE_MS) return
  lastSyncAt = Date.now()
  const state = getEmotionState()
  const cfg = {
    baseUrl,
    apiToken: moonMemory.apiToken,
  }
  syncEmotion(cfg, {
    slots: state.slots || {},
    lastSeen: state.lastSeen || Date.now(),
    timeAwareness: timeAwareness !== false,
    longingPush: longingPush !== false,
    proactiveCall: proactiveCall !== false,
  }).catch(() => {})
}
