const fs = require('node:fs');
const sharp = require('sharp');
const CARD_FONT = 'Noto Sans Canadian Aboriginal, Noto Sans Yi, Noto Sans CJK SC, Noto Sans, DejaVu Sans, sans-serif';

function fail(message) { const error = new Error(message); error.status = 400; return error; }
function xml(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]); }
function cleanConversationText(value = '') {
  return String(value)
    .replace(/<(mood|emotion|thinking|think)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:mood|emotion|thinking|think)[^>]*>/gi, '')
    .replace(/\[(?:breath|laughter|voice|endcall|MSG)\]/gi, '')
    .replace(/\[(?:call|neg|music):[^\]\n]*\]/gi, '')
    .replace(/\[\/?(?:glow|whisper|shake|blur|fade|sparkle|rainbow)\]/gi, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}
function charWidth(char) { return /[\u0000-\u00ff]/.test(char) ? 15 : 28; }
function wrapText(value, maxWidth = 560) {
  const lines = [];
  for (const paragraph of String(value).split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    const paragraphLines = []; let line = ''; let width = 0;
    // 常用颜文字作为一个整体换行，避免把脸拆成上下两半。
    const tokens = paragraph.match(/ᔦ\s*°\s*꒳\s*°\s*ᔨ|\([^\n()]{1,24}\)|./gu) || [];
    for (const token of tokens) {
      const next = lineWidth(token);
      if (line && width + next > maxWidth) { paragraphLines.push(line); line = token; width = next; }
      else { line += token; width += next; }
    }
    paragraphLines.push(line);
    if (paragraphLines.length > 1 && lineWidth(paragraphLines.at(-1)) < 84) {
      const previous = [...paragraphLines.at(-2)]; const moved = previous.splice(-Math.min(5, Math.max(2, previous.length - 1))).join('');
      paragraphLines[paragraphLines.length - 2] = previous.join(''); paragraphLines[paragraphLines.length - 1] = moved + paragraphLines.at(-1);
    }
    lines.push(...paragraphLines);
  }
  return lines;
}
function lineWidth(line) { return [...line].reduce((sum, char) => sum + charWidth(char), 0); }
async function avatarData(store, role) {
  try {
    const media = store.avatar(role);
    const png = await sharp(fs.readFileSync(media.path)).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (error) { if (error.status === 404) return ''; throw error; }
}

async function renderConversationCard({ messages, title }, store) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 8) throw fail('请选择 1 至 8 条可见消息');
  const rows = messages.map(message => {
    if (!message || !['user', 'assistant'].includes(message.role)) throw fail('消息角色只能是 user 或 assistant');
    const content = cleanConversationText(message.content).slice(0, 1800);
    if (!content) throw fail('不能收藏空消息');
    const lines = wrapText(content);
    return { role: message.role, lines, width: Math.min(620, Math.max(170, Math.max(...lines.map(lineWidth), 80) + 54)), height: lines.length * 42 + 38 };
  });
  if (rows.reduce((sum, row) => sum + row.lines.length, 0) > 110) throw fail('这段对话太长，请分成几张收藏');
  const width = 900; const height = Math.max(720, 170 + rows.reduce((sum, row) => sum + row.height + 30, 0) + 56);
  const [userAvatar, assistantAvatar] = await Promise.all([avatarData(store, 'user'), avatarData(store, 'assistant')]);
  const avatars = { user: userAvatar, assistant: assistantAvatar };
  let y = 154; const body = [];
  rows.forEach((row, index) => {
    const self = row.role === 'assistant'; const avatarSize = 58; const margin = 48; const gap = 15;
    const avatarX = self ? width - margin - avatarSize : margin;
    const bubbleX = self ? avatarX - gap - row.width : avatarX + avatarSize + gap;
    const fill = self ? 'url(#selfBubble)' : 'url(#otherBubble)'; const color = self ? '#fff' : '#302830';
    body.push(`<rect x="${bubbleX}" y="${y}" width="${row.width}" height="${row.height}" rx="24" fill="${fill}" stroke="${self ? 'rgba(255,255,255,.2)' : 'rgba(48,40,48,.12)'}" stroke-width="2" filter="url(#shadow)"/>`);
    const spans = row.lines.map((line, lineIndex) => `<tspan x="${bubbleX + 27}" y="${y + 37 + lineIndex * 42}">${xml(line || '　')}</tspan>`).join('');
    body.push(`<text fill="${color}" font-size="28" font-family="${CARD_FONT}">${spans}</text>`);
    const clip = `avatar-${index}`; const image = avatars[row.role];
    body.push(`<defs><clipPath id="${clip}"><circle cx="${avatarX + 29}" cy="${y + 31}" r="29"/></clipPath></defs>`);
    if (image) body.push(`<image href="${image}" x="${avatarX}" y="${y + 2}" width="58" height="58" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>`);
    else body.push(`<circle cx="${avatarX + 29}" cy="${y + 31}" r="29" fill="${self ? '#d48f6e' : '#c8745a'}"/><text x="${avatarX + 29}" y="${y + 39}" text-anchor="middle" fill="#fff" font-size="25" font-weight="700" font-family="${CARD_FONT}">${self ? '言' : '颖'}</text>`);
    y += row.height + 30;
  });
  const safeTitle = xml([...String(title || '这一刻')].slice(0, 22).join(''));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#8eacb7"/><stop offset=".52" stop-color="#c2c4ba"/><stop offset="1" stop-color="#dcb7a4"/></linearGradient>
      <linearGradient id="selfBubble" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c8745a"/><stop offset="1" stop-color="#da8f69"/></linearGradient>
      <linearGradient id="otherBubble" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffdf9"/><stop offset="1" stop-color="#faf6ef"/></linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="5" stdDeviation="8" flood-color="#231920" flood-opacity=".13"/></filter>
    </defs>
    <rect width="900" height="${height}" fill="url(#background)"/><rect width="900" height="126" fill="#faf8f5" fill-opacity=".91"/>
    <text x="450" y="59" text-anchor="middle" fill="#302830" font-size="34" font-weight="700" font-family="${CARD_FONT}">${safeTitle}</text>
    <text x="450" y="94" text-anchor="middle" fill="#8a7f88" font-size="22" font-family="${CARD_FONT}">从我这边看</text>
    ${body.join('')}<rect y="${height - 36}" width="900" height="36" fill="#faf8f5" fill-opacity=".42"/>
  </svg>`;
  return sharp(Buffer.from(svg), { limitInputPixels: 16000000 }).png().toBuffer({ resolveWithObject: true });
}

module.exports = { cleanConversationText, renderConversationCard, wrapText };
