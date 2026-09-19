import test from 'node:test'
import assert from 'node:assert/strict'

test('global player uses one Audio, keeps queue controls, and fully cleans on close', async () => {
  const created = []
  class FakeAudio {
    constructor() { this.style = {}; this.paused = true; this.currentTime = 0; this.duration = 180; this.listeners = {}; created.push(this) }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
    emit(type) { for (const fn of this.listeners[type] || []) fn() }
    async play() { this.paused = false; this.emit('play') }
    pause() { this.paused = true; this.emit('pause') }
    removeAttribute(name) { if (name === 'src') this.src = '' }
    load() { this.loaded = true }
  }
  globalThis.window = { __yanjiMediaAction: null }
  globalThis.navigator = {}
  globalThis.document = { body: { appendChild(node) { this.audio = node } } }
  globalThis.Audio = FakeAudio
  globalThis.fetch = async (raw) => {
    const type = new URL(raw).searchParams.get('types')
    if (type === 'url') return { ok: true, json: async () => ({ url: 'https://fixture.invalid/audio.mp3' }) }
    if (type === 'pic') return { ok: true, json: async () => ({ url: 'https://fixture.invalid/cover.jpg' }) }
    if (type === 'lyric') return { ok: true, json: async () => ({ lyric: '[00:01]fixture' }) }
    return { ok: true, json: async () => [] }
  }

  const player = await import('../src/utils/player.js')
  const first = { name: '第一首', artist: '歌手', source: 'netease', id: '1', pic_id: 'p1', lyric_id: 'l1' }
  const second = { name: '第二首', artist: '歌手', source: 'netease', id: '2', pic_id: 'p2', lyric_id: 'l2' }
  await player.playTrack(first)
  player.enqueueTrack(second)
  assert.deepEqual(player.getState().queue.map(track => track.name), ['第一首', '第二首'])
  await player.playNext()
  assert.equal(player.getState().track.name, '第二首')
  player.setQueue([first, second], 0)
  await player.playTrack(first)
  assert.equal(created.length, 1)
  assert.equal(player.getState().track.name, '第一首')
  player.togglePlay(); assert.equal(player.getState().playing, false)
  player.togglePlay(); assert.equal(player.getState().playing, true)
  await player.playNext()
  assert.equal(created.length, 1)
  assert.equal(player.getState().queueIdx, 1)
  assert.equal(player.getState().track.name, '第二首')
  await player.playPrev()
  assert.equal(player.getState().queueIdx, 0)
  player.enqueueTrack({ name: '第三首' })
  assert.equal(player.getState().queue.length, 3)
  player.stop()
  assert.equal(created.length, 1)
  assert.deepEqual(player.getState(), {
    track: null, playing: false, currentTime: 0, duration: 0, lyrics: [], loading: false,
    error: '', queue: [], queueIdx: -1,
  })
  assert.equal(created[0].loaded, true)
})
