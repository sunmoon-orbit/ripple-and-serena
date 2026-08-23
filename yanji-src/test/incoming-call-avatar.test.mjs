import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const component = fs.readFileSync(new URL('../src/components/Chat/IncomingCall.jsx', import.meta.url), 'utf8')
const styles = fs.readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8')

test('来电头像固定圆形裁切，不跟随聊天头像的方形设置', () => {
  assert.doesNotMatch(component, /avatarConfig\?\.shape/)
  assert.match(styles, /\.incall-avatar\s*\{[^}]*border-radius:\s*50%/s)
  assert.match(styles, /\.incall-avatar\s*\{[^}]*overflow:\s*hidden/s)
})
