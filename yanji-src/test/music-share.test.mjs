import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMusicShareContext, parseMusicShareContext, pendingMusicShares, queueMusicShare, subscribeMusicShares } from '../src/utils/musicShare.js'

test('music share context is explicit metadata and does not claim the model heard audio', () => {
  const text = buildMusicShareContext({
    name: '月光', artist: 'Fixture Singer', source: 'netease', id: '42',
    cover: 'https://fixture.invalid/cover.jpg', url: 'https://fixture.invalid/song.mp3',
  })
  assert.match(text, /【用户主动点歌】/)
  assert.match(text, /月光/)
  assert.match(text, /netease:42/)
  assert.match(text, /cover\.jpg/)
  assert.match(text, /song\.mp3/)
  assert.match(text, /没有听到设备正在播放的音频/)
  assert.deepEqual(parseMusicShareContext(text), {
    name: '月光', artist: 'Fixture Singer', source: 'netease', id: '42',
    cover: 'https://fixture.invalid/cover.jpg', url: 'https://fixture.invalid/song.mp3',
    pic_id: '', lyric_id: '',
  })
})

test('music shares wait for the existing Murmur or Crossing consumer', async () => {
  queueMusicShare('crossing', { name: '排队的歌', artist: '歌手' })
  assert.equal(pendingMusicShares('crossing').length, 1)
  let ready = false
  const received = []
  const unsubscribe = subscribeMusicShares('crossing', (track) => {
    if (!ready) return false
    received.push(track)
    return true
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(pendingMusicShares('crossing').length, 1)
  ready = true
  unsubscribe()
  const unsubscribeReady = subscribeMusicShares('crossing', (track) => { received.push(track); return true })
  await new Promise(resolve => setTimeout(resolve, 0))
  unsubscribeReady()
  assert.deepEqual(received.map(track => track.name), ['排队的歌'])
  assert.equal(pendingMusicShares('crossing').length, 0)
})
