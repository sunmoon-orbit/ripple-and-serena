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
const { snapshotAlbum } = require('./album-backup.cjs');
const { execFileSync } = require('node:child_process');
const { searchCommons, plain } = require('./album-search.cjs');

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
  assert.equal(store.list({ trash: true }).items[0].id, first.id);
  assert.equal(store.media(first.id, true, true).mime, 'image/jpeg');
  assert.equal(store.restore(first.id).ok, true);
  assert.equal(store.get(first.id).id, first.id);
  assert.equal(store.hide(first.id).ok, true);
  database.prepare('UPDATE album_photos SET deleted_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', first.id);
  assert.equal(store.purgeExpired(30, Date.parse('2026-09-23T00:00:00Z')).purged, 1);
  assert.equal(fs.existsSync(media.path), false);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM album_photos').get().n, 1);
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

test('Commons search returns bounded image URLs, attribution and plain text metadata', async () => {
  let requested = '';
  const results = await searchCommons('Fuzhou West Lake', async url => {
    requested = String(url);
    return new Response(JSON.stringify({ query: { pages: [{ title: 'File:Fixture.jpg', imageinfo: [{
      mime: 'image/jpeg', url: 'https://upload.wikimedia.org/original.jpg', thumburl: 'https://thumb.wikimedia.org/thumb.jpg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg', extmetadata: {
        ImageDescription: { value: '<b>West &amp; lake</b>' }, Artist: { value: '<a>Fixture Artist</a>' },
        LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      },
    }] }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  assert.match(requested, /^https:\/\/commons\.wikimedia\.org\/w\/api\.php\?/);
  assert.equal(results[0].image_url, 'https://thumb.wikimedia.org/thumb.jpg');
  assert.equal(results[0].description, 'West & lake');
  assert.equal(results[0].author, 'Fixture Artist');
  assert.equal(results[0].license, 'CC BY-SA 4.0');
  assert.equal(plain('<script>x</script> A&nbsp;B'), 'x A B');
});

test('backup includes a consistent album database and both image sizes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yanji-album-backup-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const store = createAlbumStore({ directory: source });
  const raw = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await store.save({ title: 'Fixture', image_data: `data:image/png;base64,${raw.toString('base64')}` });
  store.close();
  const destination = path.join(directory, 'backup');
  const parts = snapshotAlbum(source, destination);
  assert.deepEqual(parts, ['album.tar.gz.part-00']);
  const entries = execFileSync('tar', ['tzf', path.join(destination, parts[0])], { encoding: 'utf8' });
  assert.match(entries, /album\/album.sqlite/);
  assert.match(entries, /\.thumb.jpg/);
  assert.equal(entries.trim().split('\n').length, 4);
});

test('REST media and writes require authentication; authorized upload and thumbnail read succeed', async t => {
  const express = require('express');
  const { createAlbumRouter } = require('./album-router.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yanji-album-router-test-'));
  const database = new Database(':memory:');
  const store = createAlbumStore({ directory, database });
  const app = express(); app.use(express.json({ limit: '5mb' }));
  app.use('/moments', (req, res, next) => req.headers.authorization === 'Bearer fixture' ? next() : res.sendStatus(401));
  app.use('/moments/album', createAlbumRouter(() => store));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/moments/album`;
  assert.equal((await fetch(base)).status, 401);
  assert.equal((await fetch(`${base}/1/thumb`)).status, 401);
  const raw = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const saved = await fetch(base, { method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Fixture', image_data: `data:image/png;base64,${raw.toString('base64')}` }) });
  assert.equal(saved.status, 201);
  const item = await saved.json();
  const thumbnail = await fetch(`${base}/${item.id}/thumb`, { headers: { Authorization: 'Bearer fixture' } });
  assert.equal(thumbnail.status, 200);
  assert.match(thumbnail.headers.get('cache-control'), /no-store/);
  assert.equal((await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata()).format, 'jpeg');
  assert.equal((await fetch(`${base}/${item.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer fixture' } })).status, 200);
  assert.equal((await fetch(`${base}/${item.id}/thumb`, { headers: { Authorization: 'Bearer fixture' } })).status, 404);
  assert.equal((await fetch(`${base}/${item.id}/thumb?trash=1`, { headers: { Authorization: 'Bearer fixture' } })).status, 200);
  assert.equal((await fetch(`${base}/${item.id}/restore`, { method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
  assert.equal((await fetch(`${base}/${item.id}/thumb`, { headers: { Authorization: 'Bearer fixture' } })).status, 200);
});
