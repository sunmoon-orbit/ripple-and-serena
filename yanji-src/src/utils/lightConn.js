// 轻任务连接解析器
//
// 为什么要有这个函数：
// 用户的主连接是一个只接受 Claude 请求的中转站；而她的 DeepSeek 是官方账号，
// endpoint 和 key 完全不同。只有 lightModel 字段时，轻任务仍然打主连接的 key，
// 填 deepseek-chat 就会直接被中转站 400。
// 这个函数让轻任务可以配一套独立的 baseUrl / apiKey / provider，
// 新字段全部留空时行为和旧版完全一致（复用主连接，只换模型名）。

export function getLightConn(conn) {
  if (!conn) return conn
  // 只要 lightBaseUrl 和 lightApiKey 同时有值，才切换到独立轻连接；
  // 两者缺任意一个都退回到复用主连接——防止配到一半的半截配置把 key 搞混。
  if (conn.lightBaseUrl?.trim() && conn.lightApiKey?.trim()) {
    return {
      ...conn,
      baseUrl: conn.lightBaseUrl.trim(),
      apiKey: conn.lightApiKey.trim(),
      provider: conn.lightProvider || 'openai',
      defaultModel: conn.lightModel || conn.defaultModel,
    }
  }
  // 向后兼容：只换 defaultModel 字段，其余继承主连接
  return { ...conn, defaultModel: conn.lightModel || conn.defaultModel }
}
