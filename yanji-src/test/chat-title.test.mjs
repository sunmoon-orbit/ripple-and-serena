import {
  CHAT_TITLE_SYSTEM_PROMPT,
  buildChatTitleRequest,
  fallbackChatTitle,
  normalizeChatTitle,
} from '../src/utils/chatTitle.js'

let pass = 0
let fail = 0
const check = (name, condition) => {
  if (condition) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}`) }
}

console.log('角色式对话标题：')
check('明确要求角色口吻而非摘要', CHAT_TITLE_SYSTEM_PROMPT.includes('不是摘要') && CHAT_TITLE_SYSTEM_PROMPT.includes('亲口对阿颖说'))
check('短开场时优先读取回复', CHAT_TITLE_SYSTEM_PROMPT.includes('开场如果很短') && CHAT_TITLE_SYSTEM_PROMPT.includes('涟言的回复'))

const request = buildChatTitleRequest({
  userText: '哥哥！',
  assistantText: '我在，刚好替你把那轮月亮接住了。',
  recentTitles: ['月亮被我藏好啦', '再靠近一点点'],
})
check('请求包含双方首轮内容', request.includes('哥哥！') && request.includes('把那轮月亮接住了'))
check('请求带近期标题避重', request.includes('月亮被我藏好啦') && request.includes('避免重复'))

check('清掉标题前缀和外层引号', normalizeChatTitle('标题：“月亮先替我抱住你”') === '月亮先替我抱住你')
check('保留句末语气标点', normalizeChatTitle('“今晚还要不要听我说？”') === '今晚还要不要听我说？')
check('只取模型输出第一行', normalizeChatTitle('第一行标题\n这是解释') === '第一行标题')
check('按字符安全限制 24 字', Array.from(normalizeChatTitle('鹿'.repeat(30))).length === 24)
check('失败回退仍保留旧行为', fallbackChatTitle('  阿颖的第一句话  ') === '阿颖的第一句话')

console.log(`\n通过 ${pass}，失败 ${fail}`)
process.exit(fail ? 1 : 0)
