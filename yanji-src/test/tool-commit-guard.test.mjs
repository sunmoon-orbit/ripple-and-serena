import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createToolCommitGuard,
  TOOL_LOOP_COMMIT_GRACE,
  TOOL_LOOP_REQUEST_LIMIT,
} from '../src/api/toolCommitGuard.js'

const tools = ['nowhere_look', 'search_album_images', 'save_album_image'].map(name => ({ name }))

test('a successful image search reserves one save-only request before finalization', () => {
  const guard = createToolCommitGuard()
  guard.observe('search_album_images', { items: [{ image_url: 'https://example.org/view.jpg' }] })
  assert.equal(guard.requestLimit(), TOOL_LOOP_REQUEST_LIMIT + TOOL_LOOP_COMMIT_GRACE)
  assert.deepEqual(guard.toolsForRound(TOOL_LOOP_REQUEST_LIMIT - 1, tools).map(tool => tool.name), ['save_album_image'])
  assert.match(guard.finalizePrompt('收尾'), /尚未存入|没有收到/)
})

test('only saved:true confirms an album write', () => {
  const guard = createToolCommitGuard()
  guard.observe('search_album_images', { items: [{}] })
  guard.observe('save_album_image', '工具「save_album_image」执行失败：图片下载失败。')
  assert.equal(guard.state().albumSearchPending, true)
  assert.match(guard.reconcile('已经替你收藏好了。'), /尚未存入相册/)

  guard.observe('save_album_image', { saved: true, id: 6 })
  assert.deepEqual(guard.state(), { albumSearchPending: false, albumSaveConfirmed: true, graceEnabled: true })
  assert.equal(guard.reconcile('已经替你收藏好了。'), '已经替你收藏好了。')
  assert.match(guard.finalizePrompt('收尾'), /saved:true/)
})

test('failed searches do not add a paid grace request', () => {
  const guard = createToolCommitGuard()
  guard.observe('search_album_images', '工具「search_album_images」执行失败：网络错误。')
  assert.equal(guard.requestLimit(), TOOL_LOOP_REQUEST_LIMIT)
  assert.deepEqual(guard.toolsForRound(TOOL_LOOP_REQUEST_LIMIT - 1, tools), tools)
})
