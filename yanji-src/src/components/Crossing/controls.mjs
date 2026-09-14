export function localCommand(text) {
  const match = text.trim().match(/^\/(model|new|sessions|resume)(?:\s+(.*))?$/s)
  return match ? { name: match[1], argument: match[2] || '' } : null
}
export function imageSupported(models, model) {
  return !!models.find(m => m.model === model || m.id === model)?.inputModalities?.includes('image')
}
export function modelLabel(thread) {
  return thread?.model ? `${thread.model} · ${thread.reasoningEffort || '默认强度（未指定）'}` : '模型未知'
}
export async function uploadAttachment(config, file) {
  const url = new URL('/raven/upload?channel=crossing', config.baseUrl || 'https://memory.ravenlove.cc')
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, mime: file.mime, data: file.data }) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '上传失败')
  return { ...result, preview: file.dataUrl }
}
