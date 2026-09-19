import { useState } from 'react'
import DailyChecklist from '../Chat/DailyChecklist'
import HealthCard from '../Chat/HealthCard'
import BoardWall from '../Chat/BoardWall'
import MusicRoom from '../Chat/MusicRoom'
import WalletCard from '../Chat/WalletCard'
import GamesRoom from '../Chat/GamesRoom'
import PeriodCard from '../Chat/PeriodCard'
import HeartCardAlbum from '../Chat/HeartCardAlbum'
import IdleJournal from '../Chat/IdleJournal'
import CallHistory from '../Chat/CallHistory'
import FortuneWheel from '../Chat/FortuneWheel'
import FateDeck from '../Chat/FateDeck'
import Tarot from '../Chat/Tarot'
import DailyFortune from '../Chat/DailyFortune'
const entries = [
  ['今日小票', DailyChecklist], ['身体气象站', HealthCard],
  ['便利贴墙', BoardWall], ['涟言点的歌', MusicRoom],
  ['乌鸦钱包', WalletCard], ['游戏室', GamesRoom],
  ['小月历', PeriodCard], ['卡册', HeartCardAlbum], ['独处手账', IdleJournal],
  ['通话记录', CallHistory], ['幸运轮盘', FortuneWheel],
  ['命运牌阵', FateDeck], ['塔罗', Tarot], ['今日签', DailyFortune],
]
export default function CrossingTools({ onSend }) {
  const [selected, setSelected] = useState(null)
  const [notice, setNotice] = useState('')
  const View = selected === null ? null : entries[selected][1]
  const selectedName = selected === null ? '' : entries[selected][0]
  const viewProps = selectedName === '通话记录'
    ? { embedded: true }
    : selectedName === '命运牌阵'
      ? { onSend, targetName: 'Codex' }
      : selectedName === '塔罗'
        ? { onSend, readingTarget: 'Codex' }
        : {}
  return <><div className="crossing-tool-links"><button className="sb-tool-item" onClick={() => setNotice('语音通话当前连接的是 Murmur 对话、模型和消息会话，并不是当前 Codex Agent。请回到 Murmur 后再发起通话。')}>语音通话<small>Murmur 通话链路</small></button>{entries.map(([name], i) => <button key={name} className="sb-tool-item" onClick={() => { setNotice(''); setSelected(i) }}>{name}</button>)}</div>{notice && <p role="status">{notice}<button onClick={() => setNotice('')}>知道了</button></p>}<small>除语音通话外，工具会留在当前 Agent 会话中打开；关闭后仍回到这里。</small>{View && <View onClose={() => setSelected(null)} {...viewProps} />}</>
}
