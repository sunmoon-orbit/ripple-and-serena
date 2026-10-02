import { Fragment } from 'react'

export const CROW_EMOJI = '🐦‍⬛'
export const CROW_EMOJI_SRC = `${import.meta.env.BASE_URL}crow-emoji.svg`

const crowStyle = { backgroundImage: `url("${CROW_EMOJI_SRC}")` }

// 保留原始 emoji 文本，只把它画成随言叽打包的本地图形。
// 这样复制、搜索和信件划线的字符偏移仍然是原来的「🐦‍⬛」。
export function CrowEmoji({ className = '' }) {
  return <span className={`crow-emoji${className ? ` ${className}` : ''}`} style={crowStyle} role="img" aria-label="乌鸦">{CROW_EMOJI}</span>
}

export function CrowText({ children }) {
  const text = String(children ?? '')
  if (!text.includes(CROW_EMOJI)) return text
  return text.split(CROW_EMOJI).map((part, index, all) => (
    <Fragment key={`${index}-${part.length}`}>
      {part}
      {index < all.length - 1 && <CrowEmoji />}
    </Fragment>
  ))
}

// Markdown 由 dangerouslySetInnerHTML 落进 DOM，不能直接塞 React 组件；渲染后只替换普通文本节点。
export function enhanceCrowEmoji(root) {
  if (!root || !root.textContent?.includes(CROW_EMOJI)) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.nodeValue?.includes(CROW_EMOJI) && !node.parentElement?.closest('code, pre, textarea, .crow-emoji')) nodes.push(node)
  }
  nodes.forEach((node) => {
    const parts = node.nodeValue.split(CROW_EMOJI)
    const fragment = document.createDocumentFragment()
    parts.forEach((part, index) => {
      if (part) fragment.appendChild(document.createTextNode(part))
      if (index < parts.length - 1) {
        const crow = document.createElement('span')
        crow.className = 'crow-emoji'
        crow.style.backgroundImage = crowStyle.backgroundImage
        crow.setAttribute('role', 'img')
        crow.setAttribute('aria-label', '乌鸦')
        crow.textContent = CROW_EMOJI
        fragment.appendChild(crow)
      }
    })
    node.parentNode?.replaceChild(fragment, node)
  })
}
