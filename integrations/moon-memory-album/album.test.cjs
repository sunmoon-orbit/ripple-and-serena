const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const sharp = require('sharp');
const { createAlbumStore, decodeImage } = require('./album-store.cjs');
const { publicIPv4, resolveImageUrl } = require('./album-download.cjs');
const { call } = require('./album-mcp.cjs');

test('photos persist with thumbnails; retries deduplicate; pagination and soft hiding preserve files', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yanji-album-test-'));
  const database = new Database(':memory:');
  t.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const store = createAlbumStore({ directory, database });
  const raw = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#abcdef' } }).png().toBuffer();
  const input = { image_data: `data:image/png;base64,${raw.toString('base64')}`, title: 'Fixture photo', description: 'Synthetic test image', author: 'Fixture' };
  const first = await store.save(input);
  assert.equal((await store.save(input)).id, first.id);
  const second = await store.save({ ...input, title: 'Second fixture' });
  assert.deepEqual(store.list({ limit: 1 }).items.map(item => item.id), [second.id]);
  assert.equal(store.list({ limit: 1 }).next_cursor, second.id);
  assert.deepEqual(store.list({ before: second.id }).items.map(item => item.id), [first.id]);
  const media = store.media(first.id);
  assert.equal((await sharp(media.path).metadata()).format, 'jpeg');
  const mcp = await call('read_album_photo', { id: first.id }, store);
  assert.equal(mcp.content[1].type, 'image');
  assert.equal(mcp.content[1].mimeType, 'image/jpeg');
  assert.equal(store.hide(first.id).ok, true);
  assert.throws(() => store.media(first.id), /照片不存在/);
  assert.ok(fs.existsSync(media.path));
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM album_photos').get().n, 2);
});

test('reject invalid images and enforce storage quota without creating photo files', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yanji-album-test-'));
  const database = new Database(':memory:');
  t.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const store = createAlbumStore({ directory, database, maxStorage: 1 });
  const raw = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await assert.rejects(store.save({ title: 'Fixture', image_data: `data:image/png;base64,${raw.toString('base64')}` }), /空间已满/);
  await assert.rejects(store.save({ title: 'Fixture', image_data: 'data:image/png;base64,bm90LWltYWdl' }), /无法解码/);
  assert.throws(() => decodeImage('data:image/svg+xml;base64,PHN2Zz4='), /需要/);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('remote pictures cannot target private IPs, credential URLs, non-HTTPS or rebinding records', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.2', '169.254.169.254', '192.168.1.1', '100.64.0.1', '198.18.0.1', '::1', '203.0.113.1']) assert.equal(publicIPv4(address), false);
  assert.equal(publicIPv4('93.184.216.34'), true);
  const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
  for (const url of ['http://example.org/image.jpg', 'https://user:pass@example.org/image.jpg', 'https://example.org:8443/image.jpg']) await assert.rejects(resolveImageUrl(url, publicDns));
  await assert.rejects(resolveImageUrl('https://example.org/image.jpg', async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }]), /内网/);
  assert.equal((await resolveImageUrl('https://example.org/image.jpg', publicDns)).address, '93.184.216.34');
});
