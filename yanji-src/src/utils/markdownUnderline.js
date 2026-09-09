// 言叽扩展语法：把 __正文__ 作为下划线，而不是 CommonMark 默认的粗体。
// 内层仍交给 marked 解析，因此 ___正文___ 与 __**正文**__ 会自然组合成
// 下划线+斜体、下划线+粗体；代码跨度和围栏代码块不会进入这个 tokenizer。
export const underlineExtension = {
  name: 'underline',
  level: 'inline',
  start(src) {
    return src.indexOf('__')
  },
  tokenizer(src) {
    const match = /^__(?!\s)([^\n]*?\S)__(?!_)/.exec(src)
    if (!match) return undefined
    return {
      type: 'underline',
      raw: match[0],
      tokens: this.lexer.inlineTokens(match[1]),
    }
  },
  renderer(token) {
    return `<u>${this.parser.parseInline(token.tokens)}</u>`
  },
  childTokens: ['tokens'],
}
