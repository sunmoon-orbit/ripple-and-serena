const fs = require('node:fs');
const { getAlbumStore } = require('./album-store.cjs');
const { searchCommons } = require('./album-search.cjs');
const tools = [
  { name: 'browse_album', description: '翻共同相册，返回照片说明、收藏者和来源。用 read_album_photo 查看某张图片。', inputSchema: { type: 'object', properties: { before: { type: 'integer' }, limit: { type: 'integer', maximum: 20 } } } },
  { name: 'save_album_image', description: '把找到的公开 HTTPS 图片直链，或当前工具可读取的图片 base64，收藏到共同相册。保留真实来源；若来自图片资料库，在 description 末尾写明摄影者与许可。不要编造链接。图片不超过 4MB。', inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, author: { type: 'string' }, image_url: { type: 'string' }, image_data: { type: 'string', description: '与 image_url 二选一，data:image/...;base64,...。必须真实读取附件，不可猜造。' }, source_url: { type: 'string' } }, required: ['title', 'description', 'author'] } },
  { name: 'read_album_photo', description: '查看共同相册的一张照片，返回图片缩略图和完整描述。', inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
  { name: 'read_album_avatar', description: '读取言叽同步到服务器的当前聊天头像，供外部入口制作模型视角纪念卡。', inputSchema: { type: 'object', properties: { role: { type: 'string', enum: ['user', 'assistant'] } }, required: ['role'] } },
  { name: 'search_album_images', description: '从 Wikimedia Commons 搜索可收藏的真实图片，返回图片地址、来源页、作者和许可。找到喜欢的图后再用 save_album_image 收藏。适合旅行、地点、动植物和历史主题。', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
];
async function call(name, args = {}, store = getAlbumStore()) {
  if (name === 'browse_album') return store.list(args);
  if (name === 'save_album_image') return store.save({ ...args, source: 'mcp' });
  if (name === 'search_album_images') return searchCommons(args.query);
  if (name === 'read_album_photo') {
    const item = store.get(args.id);
    const media = store.media(args.id, true);
    return { content: [{ type: 'text', text: JSON.stringify(item) }, { type: 'image', data: fs.readFileSync(media.path).toString('base64'), mimeType: media.mime }], isError: false };
  }
  if (name === 'read_album_avatar') {
    const media = store.avatar(args.role);
    return { content: [{ type: 'text', text: JSON.stringify({ role: args.role }) }, { type: 'image', data: fs.readFileSync(media.path).toString('base64'), mimeType: media.mime }], isError: false };
  }
  throw new Error('未知相册工具');
}
module.exports = { tools, call };
