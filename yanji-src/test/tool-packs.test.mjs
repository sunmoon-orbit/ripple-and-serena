import test from 'node:test'
import assert from 'node:assert/strict'
import { groupTools, packState, togglePack } from '../src/utils/toolPacks.js'

const T = (name, enabled = false) => ({ name, enabled })

test('工具按名字归包，认不出的进「其他」，只分出一包就不显示', () => {
  const groups = groupTools([T('browse_album'), T('save_album_image'), T('write_journal'), T('read_letter'), T('search_memories'), T('draw_tarot'), T('mystery_thing')])
  assert.deepEqual(groups.map((g) => [g.id, g.names.length]), [['album', 2], ['journal', 2], ['memory', 1], ['toys', 1], ['other', 1]])
  assert.deepEqual(groupTools([T('get_file'), T('list_commits')]), [])
  assert.deepEqual(groupTools([T('browse_album'), T('get_file')]), [])
})

test('包开没开是现算的：全开才算开', () => {
  const tools = [T('browse_album', true), T('save_album_image'), T('write_journal', true)]
  assert.deepEqual(packState(tools, ['browse_album', 'save_album_image']), { on: 1, total: 2, open: false })
  assert.equal(packState(tools, ['write_journal']).open, true)
})

test('拨一包：补开没开的；全开着就整包关；不碰别的包', () => {
  const tools = [T('browse_album', true), T('save_album_image'), T('write_journal', true)]
  const opened = togglePack(tools, ['browse_album', 'save_album_image'], { selectedCount: 2, limit: 40 })
  assert.deepEqual(opened.tools.map((t) => t.enabled), [true, true, true])
  const closed = togglePack(opened.tools, ['browse_album', 'save_album_image'], { selectedCount: 3, limit: 40 })
  assert.deepEqual(closed.tools.map((t) => t.enabled), [false, false, true])
})

test('超过名额时一个都不动，并说差几个；服务关着时不占名额；关闭永远可用', () => {
  const tools = [T('a_album'), T('b_album'), T('c_album')]
  const names = tools.map((t) => t.name)
  const blocked = togglePack(tools, names, { selectedCount: 39, limit: 40 })
  assert.equal(blocked.blocked, 2)
  assert.equal(blocked.tools, tools)
  assert.equal(togglePack(tools, names, { selectedCount: 39, limit: 40, serverEnabled: false }).blocked, 0)
  const allOn = tools.map((t) => ({ ...t, enabled: true }))
  assert.deepEqual(togglePack(allOn, names, { selectedCount: 99, limit: 40 }).tools.map((t) => t.enabled), [false, false, false])
})
