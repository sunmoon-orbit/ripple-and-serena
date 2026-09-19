import { useState } from 'react'
import { useStore } from '../../store'
import DailyChecklist from '../Chat/DailyChecklist'
import HealthCard from '../Chat/HealthCard'
import BoardWall from '../Chat/BoardWall'
import MusicRoom from '../Chat/MusicRoom'
import WalletCard from '../Chat/WalletCard'
import GamesRoom from '../Chat/GamesRoom'
import PeriodCard from '../Chat/PeriodCard'
import HeartCardAlbum from '../Chat/HeartCardAlbum'
import IdleJournal from '../Chat/IdleJournal'
const entries = [
  ['今日小票', DailyChecklist], ['身体气象站', HealthCard],
  ['便利贴墙', BoardWall], ['涟言点的歌', MusicRoom],
  ['乌鸦钱包', WalletCard], ['游戏室', GamesRoom],
  ['小月历', PeriodCard], ['卡册', HeartCardAlbum], ['独处手账', IdleJournal],
]
const murmurEntries = ['语音通话', '通话记录', '幸运轮盘', '命运牌阵', '塔罗', '今日签']
export default function CrossingTools() {
  const [selected, setSelected] = useState(null)
  const [notice, setNotice] = useState('')
  const [apiTool, setApiTool] = useState('')
  const setActivePanel = useStore(s => s.setActivePanel)
  const View = selected === null ? null : entries[selected][1]
  return <><div className="crossing-tool-links">{entries.map(([name], i) => <button key={name} className="sb-tool-item" onClick={() => setSelected(i)}>{name}</button>)}{murmurEntries.map(name => <button key={name} className="sb-tool-item" onClick={() => { setApiTool(name); setNotice(`${name} 目前只能在 Murmur 页面使用；Agent 尚未接入这项能力。`) }}>{name}<small>仅 Murmur 页面支持</small></button>)}</div>{notice && <p role="status">{notice}<button onClick={() => setActivePanel('chat', apiTool === '语音通话' ? 'api-call' : undefined)}>前往 Murmur</button></p>}<small>前九项可在 Agent 中直接打开使用；后六项仍沿用 Murmur 页面能力。离开渡口会中断当前任务。</small>{View && <View onClose={() => setSelected(null)} />}</>
}
