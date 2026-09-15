import { useCallback, useEffect, useRef, useState } from 'react'
import { synthesizeSpeech } from '../../api/moonMemory'
import { speechText } from './speechText'
import { createSpeechPlayer } from './speech-player.mjs'

export function useMessageSpeech(content, config, enabled = true, resetKey = '') {
  const player = useRef(null)
  const [state, setState] = useState({ status: 'idle', duration: 0, error: '' })
  const available = !!(enabled && config?.enabled && config?.baseUrl && config?.apiToken && content?.trim())
  useEffect(() => {
    let mounted = true
    const instance = createSpeechPlayer({
      synthesize: signal => synthesizeSpeech({ baseUrl: config?.baseUrl, apiToken: config?.apiToken, crossing: config?.crossing }, speechText(content), undefined, signal),
      changed: next => { if (mounted) setState(next) },
    })
    player.current = instance
    setState(instance.state)
    return () => { mounted = false; instance.stop(); player.current = null }
  }, [content, config?.baseUrl, config?.apiToken, config?.crossing, available, resetKey])
  const toggle = useCallback(() => { if (available) return player.current?.toggle() }, [available])
  const stop = useCallback(() => player.current?.stop(), [])
  return { ...state, available, toggle, stop }
}
