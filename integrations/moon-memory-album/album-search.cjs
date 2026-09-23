const ENDPOINT = 'https://commons.wikimedia.org/w/api.php';

function plain(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ').trim();
}

async function searchCommons(query, fetchImpl = fetch) {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) throw Object.assign(new Error('请告诉我想找什么照片'), { status: 400 });
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'search',
    gsrsearch: q, gsrnamespace: '6', gsrlimit: '6', prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata', iiurlwidth: '960', iiextmetadatalanguage: 'zh',
    iiextmetadatafilter: 'ImageDescription|Artist|LicenseShortName|LicenseUrl|UsageTerms',
  });
  let response;
  try {
    response = await fetchImpl(`${ENDPOINT}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Yanji-Album/1.1 (private shared album)' },
      signal: AbortSignal.timeout(12000),
    });
  } catch { throw Object.assign(new Error('图片资料库暂时连不上'), { status: 502 }); }
  if (!response.ok) throw Object.assign(new Error('图片资料库暂时不可用'), { status: 502 });
  const data = await response.json();
  return (data.query?.pages || []).map(page => {
    const info = page.imageinfo?.[0]; const meta = info?.extmetadata || {};
    const imageUrl = info?.thumburl || info?.url;
    if (!imageUrl || !/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//i.test(imageUrl) || !/^image\/(jpeg|png|webp|gif)$/i.test(info.mime || '')) return null;
    return {
      title: plain(page.title).replace(/^File:/i, '').slice(0, 120),
      description: plain(meta.ImageDescription?.value).slice(0, 500),
      author: plain(meta.Artist?.value).slice(0, 160),
      license: plain(meta.LicenseShortName?.value || meta.UsageTerms?.value).slice(0, 100),
      license_url: String(meta.LicenseUrl?.value || '').startsWith('https://') ? meta.LicenseUrl.value : '',
      image_url: imageUrl,
      source_url: info.descriptionurl,
    };
  }).filter(Boolean);
}

module.exports = { searchCommons, plain };
