import { stripEnglishTags, stripInlineFx } from '../../utils/moodFx'

export function speechText(content = '') {
  return stripEnglishTags(stripInlineFx(content)
    .replace(/\[(music|sticker|call):[^\]]+\]/gi, '')
    .replace(/\[voice\]/gi, '')
    .replace(/\[译[:：][\s\S]*?\]/g, '')
    .replace(/\[MSG\]/gi, ' ')
    .replace(/\[(breath|laughter)\]/gi, (_, t) => t.toLowerCase() === 'laughter' ? '(laughs)' : '(breath)')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))
    .replace(/[#*`>_~\[\]]/g, '').slice(0, 500)
}
