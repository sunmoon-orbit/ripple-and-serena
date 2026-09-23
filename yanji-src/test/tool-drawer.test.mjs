import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createToolDrawer,
  TOOL_DRAWER_DIRECT_LIMIT,
  TOOL_DRAWER_MAX_GROUPS,
  TOOL_DRAWER_NAME,
} from '../src/api/toolDrawer.js'

const tool = (name) => ({ name, description: name, parameters: { type: 'object', properties: {} } })

test('small tool sets are sent directly without a drawer', () => {
  const tools = Array.from({ length: TOOL_DRAWER_DIRECT_LIMIT }, (_, index) => tool(`small_${index}`))
  const drawer = createToolDrawer(tools)
  assert.equal(drawer.enabled, false)
  assert.deepEqual(drawer.getTools(), tools)
})

test('large tool sets initially expose only core tools and the drawer', () => {
  const tools = [
    tool('search_memories'), tool('write_memory'),
    tool('list_books'), tool('read_book_chapter'), tool('get_book_annotations'), tool('annotate_book'), tool('reading_activity'),
    tool('check_weather'), tool('check_health'), tool('period_tracker'), tool('daily_checklist'), tool('send_heart_card'),
    tool('nowhere_walk'),
  ]
  const drawer = createToolDrawer(tools)
  assert.equal(drawer.enabled, true)
  assert.deepEqual(drawer.getTools().map((item) => item.name), ['search_memories', 'write_memory', TOOL_DRAWER_NAME])

  const result = drawer.open(['books'])
  assert.match(result, /书架与共读/)
  assert.deepEqual(drawer.getTools().map((item) => item.name), [
    'search_memories', 'write_memory', TOOL_DRAWER_NAME,
    'list_books', 'read_book_chapter', 'get_book_annotations', 'annotate_book', 'reading_activity',
  ])
})

test('a reply can never accumulate more than two specialist groups', () => {
  const tools = [
    tool('search_memories'),
    tool('list_books'), tool('read_book_chapter'),
    tool('check_weather'), tool('check_health'),
    tool('browse_moments'), tool('comment_moment'),
    tool('nowhere_walk'), tool('nowhere_look'),
    tool('roll_random'), tool('draw_tarot'),
    tool('web_search'), tool('make_file'),
  ]
  const drawer = createToolDrawer(tools)
  drawer.open(['books', 'life'])
  const refused = drawer.open(['social'])
  assert.match(refused, new RegExp(`最多 ${TOOL_DRAWER_MAX_GROUPS} 组`))
  const names = drawer.getTools().map((item) => item.name)
  assert.ok(names.includes('list_books'))
  assert.ok(names.includes('check_weather'))
  assert.ok(!names.includes('browse_moments'))
})

test('unknown future tools remain reachable through the other group', () => {
  const tools = Array.from({ length: 13 }, (_, index) => tool(`extension_${index}`))
  const drawer = createToolDrawer(tools)
  const opener = drawer.getTools().find((item) => item.name === TOOL_DRAWER_NAME)
  assert.ok(opener.parameters.properties.groups.items.enum.includes('other'))
  drawer.open(['other'])
  assert.equal(drawer.getTools().filter((item) => item.name.startsWith('extension_')).length, 13)
})
