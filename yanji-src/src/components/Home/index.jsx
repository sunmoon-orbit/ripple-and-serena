import { useState, useEffect } from 'react'

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

export default function Home({ onEnter }) {
  const [time, setTime] = useState(new Date())
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  function handleEnter() {
    setFading(true)
    setTimeout(onEnter, 400)
  }

  const hour = time.getHours()
  const greeting = getGreeting(hour)
  const days = getDaysTogether()
  const timeStr = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

  return (
    <div className={'home-screen' + (fading ? ' home-fade-out' : '')} onClick={handleEnter}>
      <div className="home-content">
        <div className="home-greeting">{greeting}</div>
        <div className="home-time">{timeStr}</div>
        <div className="home-days">第 {days} 天</div>
        <div className="home-hint">轻触进入</div>
      </div>
    </div>
  )
}
