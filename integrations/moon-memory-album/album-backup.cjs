const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');

// Existing backup job only; operates on the album DB, not the memory DB.
function snapshotAlbum(sourceDir, backupDir) {
  const filename = path.join(sourceDir, 'album.sqlite');
  if (!fs.existsSync(filename)) return [];
  const { createAlbumStore } = require('./album-store.cjs');
  const live = createAlbumStore({ directory: sourceDir });
  try { live.purgeExpired(30); } finally { live.close(); }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moon-album-backup-'));
  fs.chmodSync(temp, 0o700);
  try {
    const snapshot = path.join(temp, 'album');
    fs.mkdirSync(snapshot, { mode: 0o700 });
    const dbPath = path.join(snapshot, 'album.sqlite');
    const database = new Database(filename, { readonly: true, fileMustExist: true });
    try { database.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`); }
    finally { database.close(); }
    fs.chmodSync(dbPath, 0o600);
    const copy = new Database(dbPath, { readonly: true });
    let rows;
    try { rows = copy.prepare('SELECT image_file, thumb_file FROM album_photos').all(); }
    finally { copy.close(); }
    for (const row of rows) for (const name of [row.image_file, row.thumb_file]) {
      if (!/^[a-f0-9-]+(?:\.thumb)?\.(?:jpg|png)$/.test(name)) throw new Error('album_backup_invalid_filename');
      fs.copyFileSync(path.join(sourceDir, name), path.join(snapshot, name));
    }
    const archive = path.join(temp, 'album.tar.gz');
    execFileSync('tar', ['czf', archive, '-C', temp, 'album'], { timeout: 120000, stdio: 'pipe' });
    const parts = []; const chunk = Buffer.alloc(48 * 1024 * 1024);
    const handle = fs.openSync(archive, 'r');
    try {
      let count; let index = 0;
      while ((count = fs.readSync(handle, chunk, 0, chunk.length, null)) > 0) {
        const name = `album.tar.gz.part-${String(index++).padStart(2, '0')}`;
        fs.writeFileSync(path.join(temp, name), chunk.subarray(0, count), { mode: 0o600 });
        parts.push(name);
      }
    } finally { fs.closeSync(handle); }
    fs.mkdirSync(backupDir, { recursive: true });
    for (const name of parts) fs.copyFileSync(path.join(temp, name), path.join(backupDir, name));
    for (const name of fs.readdirSync(backupDir)) {
      if (/^album\.tar\.gz\.part-\d+$/.test(name) && !parts.includes(name)) fs.unlinkSync(path.join(backupDir, name));
    }
    return parts;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
module.exports = { snapshotAlbum };
