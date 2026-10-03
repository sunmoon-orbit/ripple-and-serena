import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('颜文字字库覆盖加拿大音节、彝文和组合附加符号', () => {
  // 1003：彝文那段后来扩成了 U+A000-A4CF（自托管子集 kmj-yi），老断言只认字面「A490-A4CF」才挂。
  // 改成按码位查覆盖：颜文字常用的几个字只要落在某个颜文字字体的 unicode-range 里就行
  const ranges = [...css.matchAll(/font-family:\s*'Yanji Kaomoji[^']*'[\s\S]*?unicode-range:\s*([^;]+);/g)]
    .flatMap(m => m[1].split(',').map(r => r.trim().replace(/^U\+/i, '').split('-').map(h => parseInt(h, 16))))
    .map(([a, b]) => [a, b ?? a])
  const covered = cp => ranges.some(([a, b]) => cp >= a && cp <= b)
  for (const cp of [0x1526, 0x1528, 0xA4B3, 0x0300, 0x0301]) assert.ok(covered(cp), 'U+' + cp.toString(16) + ' 没被颜文字字体覆盖')
  assert.match(css, /kmj-canadian\.woff2/) // 改成自托管子集后不再引用 fontsource 的原文件
  assert.equal(pkg.dependencies['@fontsource-variable/noto-sans-canadian-aboriginal'], '^5.3.0')
  assert.equal('ᔦ'.codePointAt(0), 0x1526)
  assert.equal('ᔨ'.codePointAt(0), 0x1528)
  assert.equal('꒳'.codePointAt(0), 0xA4B3)
})
