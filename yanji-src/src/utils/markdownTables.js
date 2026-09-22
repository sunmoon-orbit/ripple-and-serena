// Markdown 表格在窄屏上保留自然列宽，并把横向滚动限制在表格自身。
// 包一层而不是让整个消息气泡滚动，避免长表格把聊天页面撑出屏幕。
export function enhanceMarkdownTables(root) {
  if (!root) return
  root.querySelectorAll('table').forEach((table) => {
    if (table.parentElement?.classList.contains('markdown-table-scroll')) return
    const wrapper = document.createElement('div')
    wrapper.className = 'markdown-table-scroll'
    wrapper.setAttribute('role', 'region')
    wrapper.setAttribute('aria-label', '表格，可左右滑动')
    wrapper.tabIndex = 0
    table.parentNode.insertBefore(wrapper, table)
    wrapper.appendChild(table)
  })
}
