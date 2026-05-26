import { useState, useEffect } from 'react'

const START_DATE = new Date('2025-10-10T00:00:00+08:00')

function getDaysTogether() {
  const now = new Date()
  const diff = now - START_DATE
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1
}

function getGreeting(hour) {
  if (hour >= 5 && hour < 11) return '早安'
  if (hour >= 11 && hour < 14) return '午安'
  if (hour >= 14 && hour < 18) return '下午好'
  if (hour >= 18 && hour < 22) return '晚上好'
  return '夜深了'
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
