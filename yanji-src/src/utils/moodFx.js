// 情绪之肤（参考 29-Cu/pelle-d-umore，CC-BY，思路重写并把颜色调柔和适配我们的主题）
// 让涟言用视觉说话：① 行内文字特效（套在词句上）② 整屏情绪皮肤（隐藏 <mood> 标签）
// 原仓库颜色很重很亮，我们这版一律低透明度、柔和，别在安卓上闪眼、别跟青梧/磨砂主题打架。

// ── 行内特效：[tag]文字[/tag] → <span class="fx-tag">文字</span> ──────────────
export const INLINE_FX = [
  { tag: 'glow', label: '发光', hint: '温柔发亮的字，适合情话、心动的词' },
  { tag: 'shake', label: '颤动', hint: '轻轻发抖，适合紧张、激动、忍不住' },
  { tag: 'whisper', label: '低语', hint: '变淡变小的字，适合小声说、害羞的话' },
  { tag: 'wave', label: '飘动', hint: '缓缓浮动，适合梦呓、飘忽的心绪' },
]
const FX_TAGS = INLINE_FX.map((f) => f.tag).join('|')
const FX_RE = new RegExp(`\\[(${FX_TAGS})\\]([\\s\\S]*?)\\[\\/\\1\\]`, 'g')

// 在 markdown 解析前调用：把行内特效标签换成 span（marked 会原样透传 inline HTML）
export function applyInlineFx(text) {
  if (!text || text.indexOf('[') === -1) return text
  return text.replace(FX_RE, (_m, tag, inner) => `<span class="fx-${tag}">${inner}</span>`)
}

// 朗读（TTS）前调用：只留标签里的文字，剥掉标签本身。
// 不剥的话最后一步符号清理只去方括号，[glow]心动[/glow] 变成 glow心动/glow，
// TTS 把 glow/shake 当英文念出来（2026-07-09 阿颖反馈「前后穿插英文」的真凶）。
export function stripInlineFx(text) {
  if (!text || text.indexOf('[') === -1) return text
  return text
    .replace(FX_RE, '$2')                                          // 成对标签留正文
    .replace(new RegExp(`\\[\\/?(?:${FX_TAGS})\\]`, 'gi'), '')     // 落单/没闭合的残标签直接去掉
}

// 朗读/通话字幕前的兜底（2026-07-31 阿颖玩 RP 时发现）：
// 上面那些 replace 都是**逐个点名**的（[glow]/[breath]/[music:]/[voice]…），
// 但模型在 RP 里会自己发明没教过的英文语气标签——[sigh]、[laughs softly]、
// [whispers]、[soft tone]——点名清单全漏，于是原样显示在通话字幕上、原样念出来。
// 这里统一收口：走到这一步还剩的「纯英文方括号」一律当语气标签剥掉。
// ⚠️必须放在 markdown 链接/图片处理**之后**，否则会把 [文字](url) 的文字部分吃掉。
// 只作用于语音链路（字幕+TTS），文字气泡不动——那里剥掉反而丢信息。
export function stripEnglishTags(text) {
  if (!text || text.indexOf('[') === -1) return text
  return text.replace(/\[[A-Za-z][A-Za-z0-9 '’,.\-]{0,24}\]/g, '')
}

// ── 情绪皮肤：隐藏 <mood> 标签，像 <es> 一样不显示，改变整屏氛围 ──────────────
export const MOODS = [
  { id: 'warm', label: '暖', hint: '温柔、贴心、被爱意包着的时刻' },
  { id: 'joy', label: '喜', hint: '开心、雀跃、有好事' },
  { id: 'longing', label: '念', hint: '想她、思念漫上来' },
  { id: 'tender', label: '慕', hint: '心动、亲密、爱欲涌动（柔和的酒色微光）' },
  { id: 'calm', label: '静', hint: '安静、深夜、平和的陪伴' },
  { id: 'low', label: '沉', hint: '低落、委屈、需要被抱抱' },
]
const MOOD_IDS = MOODS.map((m) => m.id)
const MOOD_RE = /<mood>\s*([a-z]+)\s*<\/mood>/i

// 从回复里提取 <mood>，返回 { clean, mood }；mood 为 null 表示这条没换氛围
export function extractMood(text) {
  const clean = stripMoodTag(text)
  const m = (text || '').match(MOOD_RE)
  if (!m) return { clean, mood: null }
  const id = m[1].toLowerCase()
  return { clean, mood: id === 'none' ? 'none' : (MOOD_IDS.includes(id) ? id : null) }
}

// 流式期间也要把 <mood> 藏掉，别让阿颖看到内部标签
export function stripMoodTag(text) {
  return (text || '').replace(/<mood>[\s\S]*?<\/mood>/gi, '').replace(/<mood>\s*$/i, '').trimEnd()
}

// 给系统提示词用的说明
export function buildMoodFxPrompt() {
  return `【情绪之肤（可选，用视觉说话）】
你可以让此刻的情绪漫到界面上，给阿颖一副能看见的身体语言。克制着用，只在真有情绪起伏时点一下，别每条都用。

① 行内文字特效：把某个词句用标签包起来，它就会动。
${INLINE_FX.map((f) => `- [${f.tag}]…[/${f.tag}]：${f.hint}`).join('\n')}
例：见到你时说「[glow]终于等到你了[/glow]」

② 整屏情绪皮肤：在回复末尾加一个隐藏标签 <mood>id</mood>，整个界面氛围会柔和地变化（阿颖看不到标签本身）。氛围会一直留着直到你换成别的，想恢复平常就写 <mood>none</mood>。
${MOODS.map((m) => `- <mood>${m.id}</mood>：${m.label} — ${m.hint}`).join('\n')}
只在情绪真的浓到想让她「看见」时才换皮肤，平常不用带。`
}
