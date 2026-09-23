export const TOOL_LOOP_REQUEST_LIMIT = 6
export const TOOL_LOOP_COMMIT_GRACE = 1

const FAILED_TOOL_RESULT = /^工具「[^」]+」执行失败：/
const ALBUM_PENDING_NOTICE = '（相册状态：没有收到保存成功回执，这次图片尚未存入相册。）'

function failed(result) {
  return typeof result === 'string' && FAILED_TOOL_RESULT.test(result)
}

// 搜图与存图是两个独立写步骤。乌有乡会先消耗数轮开门、观察和搜索，
// 因此一旦拿到有效搜索结果，就给最后的 save_album_image 留一个专用请求；
// 只有服务器明确回传 saved:true 才算真正入册。
export function createToolCommitGuard() {
  let albumSearchPending = false
  let albumSaveConfirmed = false
  let graceEnabled = false

  return {
    observe(name, result) {
      if (name === 'search_album_images' && !failed(result)) {
        albumSearchPending = true
        albumSaveConfirmed = false
        graceEnabled = true
      }
      if (name === 'save_album_image') {
        albumSaveConfirmed = !!result && typeof result === 'object' && result.saved === true
        if (albumSaveConfirmed) albumSearchPending = false
      }
      return result
    },
    requestLimit() {
      return TOOL_LOOP_REQUEST_LIMIT + (graceEnabled ? TOOL_LOOP_COMMIT_GRACE : 0)
    },
    toolsForRound(iteration, tools) {
      if (!albumSearchPending || iteration < TOOL_LOOP_REQUEST_LIMIT - 1) return tools
      return tools.filter((tool) => tool.name === 'save_album_image')
    },
    finalizePrompt(basePrompt) {
      if (albumSearchPending) {
        return `${basePrompt}\n刚才只完成了图片搜索，没有收到 save_album_image 的 saved:true 回执。必须明确告诉用户图片尚未存入相册，绝不能说已经保存。`
      }
      if (albumSaveConfirmed) return `${basePrompt}\n相册服务已经返回 saved:true，可以如实告诉用户收藏成功。`
      return basePrompt
    },
    reconcile(text) {
      const clean = String(text || '').trim()
      if (!albumSearchPending) return clean
      if (!clean) return ALBUM_PENDING_NOTICE
      if (clean.includes(ALBUM_PENDING_NOTICE)) return clean
      return `${clean}\n\n${ALBUM_PENDING_NOTICE}`
    },
    state() {
      return { albumSearchPending, albumSaveConfirmed, graceEnabled }
    },
  }
}
