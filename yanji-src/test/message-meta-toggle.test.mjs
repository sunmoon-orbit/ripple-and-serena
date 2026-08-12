import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldToggleMessageMeta } from '../src/components/Chat/messageMetaToggle.js'

function targetInside(selector) {
  return {
    closest(query) {
      return query.split(',').includes(selector) ? { matches: selector } : null
    },
  }
}

test('普通气泡区域会切换消息信息行', () => {
  assert.equal(shouldToggleMessageMeta(targetInside('.bubble-markdown')), true)
})

test('链接、按钮和语音条保留自己的点击行为', () => {
  assert.equal(shouldToggleMessageMeta(targetInside('a')), false)
  assert.equal(shouldToggleMessageMeta(targetInside('button')), false)
  assert.equal(shouldToggleMessageMeta(targetInside('.voice-bar')), false)
  assert.equal(shouldToggleMessageMeta(targetInside('.bubble-attach-header')), false)
})

test('划选气泡文字时不隐藏消息信息行', () => {
  assert.equal(shouldToggleMessageMeta(targetInside('.bubble-markdown'), true), false)
})
