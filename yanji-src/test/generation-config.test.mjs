import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  MIN_MAX_OUTPUT_TOKENS,
  MAX_MAX_OUTPUT_TOKENS,
  normalizeMaxOutputTokens,
  normalizeGenerationConfig,
} from '../src/utils/generationConfig.js'

test('normal output limits stay unchanged', () => {
  assert.equal(normalizeMaxOutputTokens(8192), 8192)
  assert.equal(normalizeMaxOutputTokens('16384'), 16384)
})

test('oversized output limits are clamped before a request is built', () => {
  assert.equal(normalizeMaxOutputTokens(999999), MAX_MAX_OUTPUT_TOKENS)
  assert.equal(normalizeGenerationConfig({ maxTokens: 999999 }).maxTokens, MAX_MAX_OUTPUT_TOKENS)
})

test('invalid and undersized limits fall back safely', () => {
  assert.equal(normalizeMaxOutputTokens(undefined), DEFAULT_MAX_OUTPUT_TOKENS)
  assert.equal(normalizeMaxOutputTokens(Number.POSITIVE_INFINITY), DEFAULT_MAX_OUTPUT_TOKENS)
  assert.equal(normalizeMaxOutputTokens(1), MIN_MAX_OUTPUT_TOKENS)
})

test('normalizing generation config preserves other settings', () => {
  assert.deepEqual(normalizeGenerationConfig({ temperature: 0.4, maxTokens: 999999 }), {
    temperature: 0.4,
    maxTokens: MAX_MAX_OUTPUT_TOKENS,
  })
})
