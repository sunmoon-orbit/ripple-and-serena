// GD Studio 多音源聚合客户端 —— 纯浏览器直连，服务器零负担。
// 一个源拿不到可播链接就自动回退下一个源（很多网易云要VIP的歌，能从酷我/joox白嫖）。
const GD = 'https://music-api.gdstudio.xyz/api.php'
// 回退顺序：网易云音质好优先，拿不到依次换源
const SOURCES = ['netease', 'kuwo', 'joox', 'migu']

function artistStr(a) {
  if (Array.isArray(a)) return a.join(' / ')
  return a || ''
}

export async function searchTracks(keyword, source = 'netease', count = 5) {
  try {
    const r = await fetch(`${GD}?types=search&source=${source}&name=${encodeURIComponent(keyword)}&count=${count}`)
    if (!r.ok) return []
    const d = await r.json()
    return Array.isArray(d) ? d : []
  } catch { return [] }
}

export async function getUrl(source, id, br = 320) {
  try {
    const r = await fetch(`${GD}?types=url&source=${source}&id=${id}&br=${br}`)
    if (!r.ok) return ''
    const d = await r.json()
    return d.url || ''
  } catch { return '' }
}

export async function getCover(source, picId, size = 300) {
  if (!picId) return ''
  try {
    const r = await fetch(`${GD}?types=pic&source=${source}&id=${encodeURIComponent(picId)}&size=${size}`)
    if (!r.ok) return ''
    const d = await r.json()
    return d.url || ''
  } catch { return '' }
}

export async function getLyric(source, id) {
  try {
    const r = await fetch(`${GD}?types=lyric&source=${source}&id=${id}`)
    if (!r.ok) return []
    const d = await r.json()
    return parseLrc(d.lyric || '')
  } catch { return [] }
}

// 给一个「歌名(+歌手)」或明确的 source+id，跨源找出第一个能真正播放的版本
export async function resolvePlayable({ name, artist = '', source, id, pic_id, lyric_id }) {
  const keyword = artist ? `${name} ${artist}` : name
  const attempts = []
  // 明确指定了源和 id（歌单回放）时，优先直接试
  if (source && id) attempts.push({ direct: { source, id, pic_id, lyric_id, name, artist } })
  // 否则/其次，逐个源搜索回退
  for (const s of SOURCES) attempts.push({ search: s })

  for (const a of attempts) {
    let cand
    if (a.direct) {
      cand = a.direct
    } else {
      const list = await searchTracks(keyword, a.search, 3)
      if (!list.length) continue
      const top = list[0]
      cand = {
        source: a.search,
        id: top.url_id || top.id,
        pic_id: top.pic_id,
        lyric_id: top.lyric_id || top.id,
        name: top.name,
        artist: artistStr(top.artist),
      }
    }
    const url = await getUrl(cand.source, cand.id)
    if (url) {
      const cover = await getCover(cand.source, cand.pic_id)
      return {
        url, source: cand.source, id: String(cand.id),
        name: cand.name || name, artist: cand.artist || artist,
        cover, pic_id: cand.pic_id || '', lyric_id: String(cand.lyric_id || cand.id),
      }
    }
  }
  return null
}

// LRC 解析成 [{t: 秒, text}]，供滚动歌词用
function parseLrc(lrc) {
  const out = []
  lrc.split('\n').forEach((line) => {
    const m = line.match(/^((?:\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?\])+)(.*)$/)
    if (!m) return
    const text = m[2].trim()
    if (!text) return
    const times = m[1].match(/\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?\]/g) || []
    times.forEach((t) => {
      const mm = t.match(/\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/)
      if (mm) {
        const sec = (+mm[1]) * 60 + (+mm[2]) + (mm[3] ? parseFloat(`0.${mm[3]}`) : 0)
        out.push({ t: sec, text })
      }
    })
  })
  return out.sort((a, b) => a.t - b.t)
}
