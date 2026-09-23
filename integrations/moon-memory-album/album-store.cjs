const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
const sharp = require('sharp');
const { downloadImage, MAX_BYTES } = require('./album-download.cjs');

function fail(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function clean(value, max, fallback = '') { return String(value ?? fallback).trim().slice(0, max); }
function decodeImage(data) {
  if (typeof data !== 'string' || data.length > MAX_BYTES * 1.4 + 100) throw fail('图片为空或超过 4 MB');
  const match = /^data:image\/(?:jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) throw fail('需要 PNG、JPEG、WebP 或 GIF 图片');
  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) throw fail('图片为空或超过 4 MB');
  return bytes;
}

function createAlbumStore({ directory, database, fetchImage = downloadImage, maxStorage = 200 * 1024 * 1024 }) {
  fs.mkdirSync(directory, { recursive: true });
  const connection = database || new Database(path.join(directory, 'album.sqlite'));
  // New independent database. Importing this module does not touch the memory database.
  connection.exec(`CREATE TABLE IF NOT EXISTS album_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, description TEXT NOT NULL, author TEXT NOT NULL,
    source TEXT NOT NULL, source_url TEXT NOT NULL, created_at TEXT NOT NULL,
    image_file TEXT NOT NULL, thumb_file TEXT NOT NULL, mime TEXT NOT NULL,
    width INTEGER NOT NULL, height INTEGER NOT NULL, bytes INTEGER NOT NULL,
    fingerprint TEXT NOT NULL, deleted_at TEXT
  ); CREATE INDEX IF NOT EXISTS album_fingerprint ON album_photos(fingerprint);`);
  let pending = 0;
  const publicItem = row => row && ({ id: row.id, title: row.title, description: row.description, author: row.author, source: row.source, source_url: row.source_url, created_at: row.created_at, width: row.width, height: row.height });
  const find = id => connection.prepare('SELECT * FROM album_photos WHERE id = ? AND deleted_at IS NULL').get(Number(id));

  async function save(input = {}) {
    // Keep concurrent image decoding bounded on the 2 GB VPS.
    if (pending >= 2) throw fail('相册正在处理图片，请稍后再试', 429);
    pending++;
    try {
      const title = clean(input.title, 80);
      const description = clean(input.description, 4000);
      const author = clean(input.author, 80, '未署名');
      const source = clean(input.source, 24, 'mcp');
      const sourceUrl = clean(input.source_url || input.image_url, 2000);
      if (!title || !author) throw fail('请填写照片名字和收藏者');
      if (sourceUrl) {
        let parsed;
        try { parsed = new URL(sourceUrl); } catch { throw fail('来源链接无效'); }
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw fail('来源需要 HTTPS 网页地址');
      }
      if (Boolean(input.image_data) === Boolean(input.image_url)) throw fail('请提供一张图片或一个图片链接');
      const raw = input.image_data ? decodeImage(input.image_data) : await fetchImage(String(input.image_url));
      if (raw.length > MAX_BYTES) throw fail('图片超过 4 MB');
      let image; let thumb; let info;
      try {
        const metadata = await sharp(raw, { limitInputPixels: 16000000, animated: false }).metadata();
        if (!['jpeg', 'png', 'webp', 'gif'].includes(metadata.format)) throw fail('不支持的图片格式');
        const pipeline = sharp(raw, { limitInputPixels: 16000000, animated: false }).rotate().resize({ width: 1800, height: 6000, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#faf8f2' });
        const result = source === 'conversation' ? await pipeline.png().toBuffer({ resolveWithObject: true }) : await pipeline.jpeg({ quality: 86 }).toBuffer({ resolveWithObject: true });
        image = result.data; info = result.info;
        thumb = await sharp(image).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 74 }).toBuffer();
      } catch { throw fail('图片无法解码，或分辨率过大'); }
      const fingerprint = createHash('sha256').update(image).update(JSON.stringify([title, description, author, source, sourceUrl])).digest('hex');
      const existing = connection.prepare('SELECT * FROM album_photos WHERE fingerprint = ? AND deleted_at IS NULL').get(fingerprint);
      if (existing) return publicItem(existing);
      const bytes = image.length + thumb.length;
      if (bytes > MAX_BYTES) throw fail('处理后的图片仍超过 4 MB');
      // Everything after the await is synchronous: quota check + insert cannot race.
      const used = connection.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM album_photos').get().bytes;
      if (used + bytes > maxStorage) throw fail('相册空间已满，请联系维护者扩容', 507);
      const key = randomUUID(); const ext = source === 'conversation' ? 'png' : 'jpg';
      const imageFile = `${key}.${ext}`; const thumbFile = `${key}.thumb.jpg`;
      try {
        fs.writeFileSync(path.join(directory, imageFile), image, { flag: 'wx', mode: 0o600 });
        fs.writeFileSync(path.join(directory, thumbFile), thumb, { flag: 'wx', mode: 0o600 });
        const result = connection.prepare('INSERT INTO album_photos (title, description, author, source, source_url, created_at, image_file, thumb_file, mime, width, height, bytes, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(title, description, author, source, sourceUrl, new Date().toISOString(), imageFile, thumbFile, ext === 'png' ? 'image/png' : 'image/jpeg', info.width, info.height, bytes, fingerprint);
        return publicItem(find(result.lastInsertRowid));
      } catch (error) {
        // Only files generated for this failed insert; never remove existing photos.
        for (const name of [imageFile, thumbFile]) { try { fs.unlinkSync(path.join(directory, name)); } catch {} }
        throw error;
      }
    } finally { pending--; }
  }
  return {
    save,
    list({ before, limit = 20 } = {}) {
      const count = Math.min(20, Math.max(1, Math.floor(Number(limit) || 20)));
      const cursor = Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER;
      const rows = connection.prepare('SELECT * FROM album_photos WHERE deleted_at IS NULL AND id < ? ORDER BY id DESC LIMIT ?').all(cursor, count + 1);
      return { items: rows.slice(0, count).map(publicItem), next_cursor: rows.length > count ? rows[count - 1].id : null };
    },
    get(id) { const row = find(id); if (!row) throw fail('照片不存在', 404); return publicItem(row); },
    media(id, thumbnail = false) {
      const row = find(id); if (!row) throw fail('照片不存在', 404);
      return { path: path.join(directory, thumbnail ? row.thumb_file : row.image_file), mime: thumbnail ? 'image/jpeg' : row.mime };
    },
    hide(id) { return { ok: connection.prepare('UPDATE album_photos SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(new Date().toISOString(), Number(id)).changes > 0 }; },
    close() { if (!database) connection.close(); },
  };
}

let singleton;
function getAlbumStore() {
  if (!singleton) {
    const directory = path.join(__dirname, '..', 'data', 'album');
    fs.mkdirSync(directory, { recursive: true });
    singleton = createAlbumStore({ directory });
  }
  return singleton;
}
module.exports = { createAlbumStore, getAlbumStore, decodeImage };
