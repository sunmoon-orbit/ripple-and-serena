import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanConversationCardText } from '../src/api/album.js'

test('conversation cards keep visible words and remove hidden voice or display protocol tags', () => {
  const input = '[glow]想你[/glow][breath]，[laughter]抱一下。<mood>tender</mood>[voice][call:想听你说话][MSG]'
  assert.equal(cleanConversationCardText(input, 'assistant'), '想你，抱一下。')
  assert.equal(cleanConversationCardText('ᔦ ° ꒳ ° ᔨ ( ¯꒳¯̥̥ )', 'user'), 'ᔦ ° ꒳ ° ᔨ ( ¯꒳¯̥̥ )')
})
