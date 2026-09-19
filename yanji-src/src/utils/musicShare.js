const targets = ['chat', 'crossing']
const pending = new Map(targets.map((target) => [target, []]))
const listeners = new Map(targets.map((target) => [target, new Set()]))
const flushing = new Set()

function clean(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim()
}

export function normalizeSharedTrack(track = {}) {
  return {
    name: clean(track.name) || '未知曲目',
    artist: clean(Array.isArray(track.artist) ? track.artist.join(' / ') : track.artist) || '未知歌手',
    cover: clean(track.cover),
    url: clean(track.url),
    source: clean(track.source),
    id: clean(track.id || track.url_id),
    pic_id: clean(track.pic_id),
    lyric_id: clean(track.lyric_id),
  }
}

// This is ordinary user-turn text, not a second transport protocol. Both Murmur's
// existing model request and Crossing's existing turn/start carry it unchanged.
export function buildMusicShareContext(track) {
  const song = normalizeSharedTrack(track)
  const lines = [
    '【用户主动点歌】',
    `用户把这首歌点给你：${song.name}`,
    `歌手：${song.artist}`,
  ]
  if (song.source || song.id) lines.push(`歌曲标识：${[song.source, song.id].filter(Boolean).join(':')}`)
  if (song.cover) lines.push(`封面：${song.cover}`)
  if (song.url) lines.push(`现有播放链接：${song.url}`)
  lines.push('这是用户主动分享的歌曲元数据；你没有听到设备正在播放的音频。请把它当作对你的一次点歌，自然回应。')
  return lines.join('\n')
}

export function parseMusicShareContext(text) {
  const value = String(text || '')
  if (!value.startsWith('【用户主动点歌】\n')) return null
  const read = (label) => value.split('\n').find((line) => line.startsWith(label))?.slice(label.length).trim() || ''
  const marker = read('歌曲标识：')
  const split = marker.indexOf(':')
  return normalizeSharedTrack({
    name: read('用户把这首歌点给你：'),
    artist: read('歌手：'),
    source: split >= 0 ? marker.slice(0, split) : '',
    id: split >= 0 ? marker.slice(split + 1) : marker,
    cover: read('封面：'),
    url: read('现有播放链接：'),
  })
}

async function flush(target) {
  if (flushing.has(target)) return
  flushing.add(target)
  try {
    const queue = pending.get(target)
    while (queue.length && listeners.get(target).size) {
      const item = queue[0]
      let accepted = false
      for (const listener of listeners.get(target)) {
        if (await listener(item) !== false) { accepted = true; break }
      }
      if (!accepted) break
      queue.shift()
    }
  } finally {
    flushing.delete(target)
  }
}

export function queueMusicShare(target, track) {
  const destination = target === 'crossing' ? 'crossing' : 'chat'
  pending.get(destination).push(normalizeSharedTrack(track))
  void flush(destination)
}

export function subscribeMusicShares(target, listener) {
  const destination = target === 'crossing' ? 'crossing' : 'chat'
  listeners.get(destination).add(listener)
  void flush(destination)
  return () => listeners.get(destination).delete(listener)
}

export function pendingMusicShares(target) {
  return [...pending.get(target === 'crossing' ? 'crossing' : 'chat')]
}
