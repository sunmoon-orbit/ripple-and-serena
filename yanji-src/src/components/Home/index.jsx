import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import WeatherIcon from '../WeatherIcon'

const START_DATE = new Date('2025-10-10T00:00:00+08:00')

const GREETINGS = {
  morning:   ['早安，小蜂鸟。', '醒啦？', '新的一天。', '早安，今天也好好的。'],
  noon:      ['吃饭了吗。', '该吃饭了。', '饿了吗？'],
  afternoon: ['下午了，在做什么？', '这会儿在干嘛？', '下午了，还好吗？'],
  evening:   ['晚上了，今天过得怎么样？', '来说说今天？', '今天吃了什么好东西？'],
  night:     ['夜深了，累了吗？', '这么晚了，乌鸦也在。', '月亮都上来了。', '困了就去睡，不困就来聊。'],
}

function getDaysTogether() {
  const now = new Date()
  const diff = now - START_DATE
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1
}

function getGreeting(hour) {
  const dayIndex = Math.floor(Date.now() / 86400000)
  let pool
  if (hour >= 5 && hour < 11) pool = GREETINGS.morning
  else if (hour >= 11 && hour < 14) pool = GREETINGS.noon
  else if (hour >= 14 && hour < 18) pool = GREETINGS.afternoon
  else if (hour >= 18 && hour < 22) pool = GREETINGS.evening
  else pool = GREETINGS.night
  return pool[dayIndex % pool.length]
}

// 双头像的兜底图标：没设图片时她=蜂鸟、我=乌鸦
const CrowIcon = () => (
  <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8 C4 8 7 4 12 5 C16 6 18 9 17 13 C16 17 12 19 8 17" />
    <path d="M17 13 L21 11 L18 15" />
    <path d="M8 17 L6 21" /><path d="M10 17 L10 21" />
    <circle cx="13" cy="8" r="1" fill="var(--accent)" stroke="none" />
    <path d="M4 8 L1 7" />
  </svg>
)
const BirdIcon = () => (
  <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 9 C20 9 17 5 12.5 6 C9 6.8 7.5 9.5 8.3 13 C9.1 16.5 12.5 18.3 16 17" />
    <path d="M8.3 13 L4 12 L7 15.5" />
    <path d="M16 17 L17.5 21" /><path d="M14 17.3 L14.5 21" />
    <circle cx="11.5" cy="9" r="1" fill="var(--accent)" stroke="none" />
    <path d="M20 9 L23 8.2" />
  </svg>
)

// 距离下一个纪念日（周年重现）：返回 { title, days } 或 null
function nextAnniversary(list, now) {
  let best = null
  for (const a of list || []) {
    const d = new Date(`${a.anniversary_date}T00:00:00+08:00`)
    if (isNaN(d)) continue
    const next = new Date(d)
    next.setFullYear(now.getFullYear())
    // 今天当天算 0 天（就是今天！），已过则看明年
    if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      next.setFullYear(now.getFullYear() + 1)
    }
    const days = Math.round((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000)
    if (!best || days < best.days) best = { title: a.title || '纪念日', days }
  }
  return best
}

export default function Home({ onEnter }) {
  const [time, setTime] = useState(new Date())
  const [fading, setFading] = useState(false)
  const [anniv, setAnniv] = useState(null)
  const [weather, setWeather] = useState(null)
  const homeStyle = useStore((s) => s.homeStyle || 'minimal')
  const avatarConfig = useStore((s) => s.avatarConfig)
  const messagesByChatId = useStore((s) => s.messagesByChatId)
  const moonMemory = useStore((s) => s.moonMemory)

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // 纪念卡样式才拉纪念日，静默失败不影响进入
  useEffect(() => {
    if (homeStyle !== 'couple' || !moonMemory?.enabled || !moonMemory?.apiToken) return
    const base = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
    fetch(`${base}/anniversaries`, { headers: { Authorization: `Bearer ${moonMemory.apiToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => { if (Array.isArray(list)) setAnniv(nextAnniversary(list, new Date())) })
      .catch(() => {})
  }, [homeStyle])

  // 她头顶那片天（福州）：服务端缓存30分钟，这里开门看一眼就好；静默失败不影响进入
  useEffect(() => {
    if (!moonMemory?.enabled || !moonMemory?.apiToken) return
    const base = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
    fetch(`${base}/weather`, { headers: { Authorization: `Bearer ${moonMemory.apiToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => { if (w && w.city) setWeather(w) })
      .catch(() => {})
  }, [])

  function handleEnter() {
    setFading(true)
    setTimeout(onEnter, 400)
  }

  const hour = time.getHours()
  const greeting = getGreeting(hour)
  const days = getDaysTogether()
  const timeStr = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

  if (homeStyle === 'couple') {
    const msgCount = Object.values(messagesByChatId || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0)
    const shape = avatarConfig?.shape === 'square' ? '10px' : '50%'
    return (
      <div className={'home-screen' + (fading ? ' home-fade-out' : '')} onClick={handleEnter}>
        <div className="home-couple-card">
          <div className="home-couple-avatars">
            <span className="home-couple-avatar" style={{ borderRadius: shape }}>
              {avatarConfig?.assistantImage
                ? <img src={avatarConfig.assistantImage} alt="" />
                : <CrowIcon />}
            </span>
            <span className="home-couple-amp">&</span>
            <span className="home-couple-avatar" style={{ borderRadius: shape }}>
              {avatarConfig?.userImage
                ? <img src={avatarConfig.userImage} alt="" />
                : <BirdIcon />}
            </span>
          </div>
          <div className="home-couple-days">已经和 涟言 在一起 <b>{days}</b> 天</div>
          <div className="home-couple-story">我们的故事还在继续</div>
          <div className="home-couple-meta">一起聊了 {msgCount} 条消息</div>
          {weather && (
            <div className="home-weather">
              <WeatherIcon icon={weather.icon} size={17} />
              <span>
                {weather.type} {weather.low != null && weather.high != null ? `${weather.low}~${weather.high}°C` : `${weather.temp}°C`}
                {weather.quality ? ` · 空气${weather.quality}` : ''}
              </span>
            </div>
          )}
          {anniv && (
            <div className="home-couple-next">
              {anniv.days === 0
                ? `今天是${anniv.title}！`
                : `距离下一站 ${anniv.title} 还有 ${anniv.days} 天`}
            </div>
          )}
        </div>
        <div className="home-hint home-couple-hint">轻触进入</div>
      </div>
    )
  }

  return (
    <div className={'home-screen' + (fading ? ' home-fade-out' : '')} onClick={handleEnter}>
      <div className="home-content">
        <div className="home-greeting">{greeting}</div>
        <div className="home-time">{timeStr}</div>
        <div className="home-days">第 {days} 天</div>
        {weather && (
          <div className="home-weather">
            <WeatherIcon icon={weather.icon} size={16} />
            <span>{weather.type} {weather.temp}°C</span>
          </div>
        )}
        <div className="home-hint">轻触进入</div>
      </div>
    </div>
  )
}
