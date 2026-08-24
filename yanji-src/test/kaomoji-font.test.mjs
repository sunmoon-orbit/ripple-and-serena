import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('颜文字字库覆盖加拿大音节、彝文和组合附加符号', () => {
  assert.match(css, /U\+1400-167F/)
  assert.match(css, /U\+A490-A4CF/)
  assert.match(css, /U\+0300-036F/)
  assert.match(css, /noto-sans-canadian-aboriginal-canadian-aboriginal-wght-normal\.woff2/)
  assert.equal(pkg.dependencies['@fontsource-variable/noto-sans-canadian-aboriginal'], '^5.3.0')
  assert.equal('ᔦ'.codePointAt(0), 0x1526)
  assert.equal('ᔨ'.codePointAt(0), 0x1528)
  assert.equal('꒳'.codePointAt(0), 0xA4B3)
})
