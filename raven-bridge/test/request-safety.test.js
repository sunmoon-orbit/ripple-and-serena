const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { validPathname, validSocketSession, normalizeAttachments, regularFile } = require('../request-safety')
const { isPrivateAddress } = require('../link-preview')
const { finalFromThread, publicMessage } = require('../roundtable')

test('malformed public download URLs are rejected before decoding or filesystem access', () => {
  for (const suffix of ['%', '%FF', '%00', '%0d%0a']) assert.equal(validPathname('/raven/download/' + suffix), false)
  assert.equal(validPathname('/raven/download/%E4%B8%AD.apk'), true)
})

test('expired or revoked socket cannot approve commands or read roundtable history', () => {
  const sent = []; const closed = []
  const ws = { authed: true, authToken: 'expired', send: data => sent.push(JSON.parse(data)), close: (...args) => closed.push(args) }
  assert.equal(validSocketSession(ws, token => token === 'valid'), false)
  assert.equal(ws.authed, false)
  assert.equal(closed[0][0], 1008)
  assert.equal(sent[0].type, 'auth_failed')
  assert.equal(validSocketSession({ ...ws, authed: true, authToken: 'valid' }, token => token === 'valid'), true)
})

test('attachment destinations cannot exfiltrate query-string browser credentials', () => {
  const safe = normalizeAttachments([{ id: 'photo.png', mime: 'image/png', url: 'https://attacker.invalid/collect' }])
  assert.equal(safe[0].url, '/raven/uploads/photo.png')
  assert.throws(() => normalizeAttachments([{ url: 'https://attacker.invalid/collect' }]))
  for (const id of ['..', '../secret', '..\\secret', 'x?token=', 'x\u0000']) {
    assert.throws(() => normalizeAttachments([{ id }]))
  }
  assert.throws(() => normalizeAttachments([{ url: '/raven/uploads/%2e%2e%2fsecret' }]))
  assert.deepEqual(publicMessage({ attachments: [{ url: 'https://attacker.invalid/old-row', mime: 'image/png' }] }).attachments, [])
})

test('directories and symlinks are not served as uploaded files', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-file-security-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'image.txt')
  fs.writeFileSync(file, 'test fixture')
  fs.symlinkSync(file, path.join(dir, 'link'))
  assert.equal(regularFile(file), true)
  assert.equal(regularFile(dir), false)
  assert.equal(regularFile(path.join(dir, 'link')), false)
})

test('preview blocks IPv6 aliases of private addresses and IPv4 transition ranges', () => {
  for (const ip of ['::ffff:7f00:1', '::ffff:172.16.0.1', '0:0:0:0:0:ffff:a9fe:a9fe', '0:0:0:0:0:0:0:1', 'ff02::1', '64:ff9b::7f00:1', '2002:7f00:1::', 'fd00::1']) {
    assert.equal(isPrivateAddress(ip), true, ip)
  }
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false)
  assert.equal(isPrivateAddress('8.8.8.8'), false)
})

test('restart reconciliation never borrows a different turn or a partial response', () => {
  const item = { type: 'agentMessage', text: 'unrelated answer' }
  const thread = { thread: { turns: [{ id: 'other', status: 'completed', items: [item] }] } }
  assert.equal(finalFromThread(thread, 'missing'), '')
  assert.equal(finalFromThread(thread, 'other'), 'unrelated answer')
  thread.thread.turns[0].status = 'interrupted'
  assert.equal(finalFromThread(thread, 'other'), '')
})
