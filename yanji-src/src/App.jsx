import { useStore } from './store'
import IconNav from './components/IconNav'
import Chat from './components/Chat'
import Memory from './components/Memory'
import Dream from './components/Dream'
import Settings from './components/Settings'
import Toast from './components/Toast'

export default function App() {
  const activePanel = useStore((s) => s.activePanel)

  return (
    <div className="app-shell">
      <IconNav />
      <div className="main-area">
        {activePanel === 'chat' && <Chat />}
        {activePanel === 'memory' && <Memory />}
        {activePanel === 'dream' && <Dream />}
        {activePanel === 'settings' && <Settings />}
      </div>
      <Toast />
    </div>
  )
}
