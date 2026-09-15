// The marker is only an in-process routing hint, never a network URL.
export function toolFetch(value, options = {}) {
  if (!String(value).startsWith('crossing+')) return fetch(value, options)
  const url = new URL(String(value).slice(9))
  return fetch(`${url.origin}/raven/upload?channel=crossing`, {
    method: 'POST', signal: options.signal,
    headers: { Authorization: options.headers?.Authorization || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'tool', path: url.pathname + url.search, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined }),
  })
}
