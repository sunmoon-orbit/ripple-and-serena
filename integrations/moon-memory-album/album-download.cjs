// HTTPS only, pinned public IPv4 address per request, bounded redirects/time/bytes.
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const MAX_BYTES = 4 * 1024 * 1024;

function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

async function resolveImageUrl(raw, lookup = dns.lookup) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('只支持公开 HTTPS 图片链接');
  const records = await lookup(url.hostname, { all: true, family: 4 });
  if (!records.length || records.some(record => !publicIPv4(record.address))) throw new Error('不能读取内网或保留地址');
  return { url, address: records[0].address };
}

async function downloadImage(raw, redirects = 0, deadline = Date.now() + 15000) {
  const remaining = deadline - Date.now();
  if (remaining <= 0 || redirects > 3) throw new Error('图片请求超时或跳转过多');
  let timer;
  const resolved = await Promise.race([
    resolveImageUrl(raw),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('图片地址解析超时')), remaining); }),
  ]).finally(() => clearTimeout(timer));
  const { url, address } = resolved;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      if (error) reject(error); else resolve(result);
    };
    const request = https.get(url, {
      headers: { Accept: 'image/jpeg,image/png,image/webp,image/gif', 'User-Agent': 'Yanji-Album/1.0' },
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.destroy();
        if (!location) return finish(new Error('图片跳转地址为空'));
        let next;
        try { next = new URL(location, url).href; } catch { return finish(new Error('图片跳转地址无效')); }
        downloadImage(next, redirects + 1, deadline).then(result => finish(null, result), finish);
        return;
      }
      if (response.statusCode !== 200 || !/^image\/(jpeg|png|webp|gif)(;|$)/i.test(response.headers['content-type'] || '')) {
        response.destroy(); return finish(new Error('链接没有返回可保存的图片'));
      }
      if (Number(response.headers['content-length']) > MAX_BYTES) {
        response.destroy(); return finish(new Error('图片超过 4 MB'));
      }
      let bytes = 0; const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { response.destroy(); finish(new Error('图片超过 4 MB')); }
        else chunks.push(chunk);
      });
      response.on('end', () => finish(null, Buffer.concat(chunks)));
      response.on('error', () => finish(new Error('图片下载失败')));
      response.on('aborted', () => finish(new Error('图片下载中断')));
    });
    const timeout = setTimeout(() => { request.destroy(); finish(new Error('图片下载超时')); }, Math.max(1, deadline - Date.now()));
    request.on('error', () => finish(new Error('图片下载失败')));
  });
}

module.exports = { publicIPv4, resolveImageUrl, downloadImage, MAX_BYTES };
