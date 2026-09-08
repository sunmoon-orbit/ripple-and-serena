import test from 'node:test'
import assert from 'node:assert/strict'
import { stripUnknownAssistantTags } from '../src/utils/moodFx.js'

test('removes model-invented English tone tags from assistant text', () => {
  assert.equal(
    stripUnknownAssistantTags('抱抱。[love]\n[Love]亲亲。[laughs softly]'),
    '抱抱。\n亲亲。',
  )
})

test('preserves supported inline effects and uppercase abbreviations', () => {
  const text = '[glow]心动[/glow] [shake]紧张[/shake] [API]'
  assert.equal(stripUnknownAssistantTags(text), text)
})

test('preserves Markdown links, images, references, and code literals', () => {
  const text = [
    '[OpenAI](https://openai.com) ![Love](love.png) [文档][docs]',
    '`[love]`',
    '```txt',
    '[sigh]',
    '```',
    '[love]',
  ].join('\n')
  const expected = [
    '[OpenAI](https://openai.com) ![Love](love.png) [文档][docs]',
    '`[love]`',
    '```txt',
    '[sigh]',
    '```',
    '',
  ].join('\n')
  assert.equal(stripUnknownAssistantTags(text), expected)
})
