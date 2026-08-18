import test from 'node:test'
import assert from 'node:assert/strict'

import { hasNativeDownloadBridge } from '../src/utils/download.js'

test.afterEach(() => {
  delete globalThis.window
})

test('browser without Yanji bridge is not treated as native', () => {
  globalThis.window = {}
  assert.equal(hasNativeDownloadBridge(), false)
})

test('detects the Kotlin bridge through isNative', () => {
  globalThis.window = {
    YanjiNative: {
      isNative: () => true,
      saveBase64File: () => {},
    },
  }
  assert.equal(hasNativeDownloadBridge(), true)
})

test('keeps compatibility with a bridge exposing only saveBase64File', () => {
  globalThis.window = {
    YanjiNative: { saveBase64File: () => {} },
  }
  assert.equal(hasNativeDownloadBridge(), true)
})
