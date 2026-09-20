import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

// This test boots the real app but cannot reach any external HTTP or WS server.
test('real Crossing components preserve thread state across tools and model apply', { timeout: 120000 }, async t => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const server = await createServer({ root, base: '/', server: { host: '127.0.0.1', port: 0, hmr: false } })
  t.after(() => server.close())
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  let ttsRequests = 0, modelRequests = 0
  let delayTts = false, failTts = false, heldTts = null
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    if (url.pathname === '/tts' || (url.pathname === '/raven/upload' && route.request().postDataJSON()?.action === 'tts')) {
      ttsRequests++
      if (delayTts) { heldTts = route; return }
      return route.fulfill({ status: failTts ? 500 : 200, json: failTts ? { error: 'fixture failure' } : { audio: 'fixture-audio' } })
    }
    if (/chat\/completions|\/messages$|\/responses$/.test(url.pathname)) modelRequests++
    return route.fulfill({ json: [] })
  })
  // Additional safety: no native WebSocket may reach the network even if a
  // future component stops using our JS fixture.
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.addInitScript(() => {
    if (!localStorage.getItem('crossing-fixture-seeded')) {
      localStorage.setItem('crossing-fixture-seeded', 'yes')
      localStorage.setItem('yanji_navigation_v1', JSON.stringify({ panel: 'crossing', murmur: 'crossing', threadId: 'thread-luna' }))
      localStorage.setItem('llm_hub_state_v1', JSON.stringify({ moonMemory: { enabled: true, baseUrl: 'https://fixture.invalid', apiToken: 'test-only' }, timeAwareness: false, longingPush: false, proactiveCall: false }))
    }
    window.__wire = []; window.__sockets = []; window.__audios = []
    window.__thread = id => {
      const confirmed = JSON.parse(localStorage.getItem(`fixture-model-${id}`) || 'null') || { model: 'gpt-5.6-luna', effort: 'low' }
      return { id, name: `Fixture ${id}`, model: confirmed.model, reasoningEffort: confirmed.effort, turns: [{ id: 'old-turn', status: 'completed', items: [{ id: 'old', type: 'agentMessage', text: '完整的历史回复' }] }] }
    }
    class FakeSocket {
      static OPEN = 1
      constructor() { this.readyState = 0; window.__sockets.push(this); setTimeout(() => { if (this.readyState === 3) return; this.readyState = 1; this.onopen?.() }, 0) }
      emit(data) { this.onmessage?.({ data: JSON.stringify(data) }) }
      send(raw) {
        const m = JSON.parse(raw); window.__wire.push(m)
        setTimeout(() => {
          if (this.readyState !== 1) return
          if (m.type === 'crossing/auth') this.emit(m.enabled === true && m.token === 'test-only'
            ? { type: 'crossing/authenticated', capability: 'fixture-capability', expiresAt: Date.now() + 60000 }
            : { type: 'crossing/auth_failed' })
          if (m.type === 'crossing/thread/list') this.emit({ type: 'crossing/threads', threads: [window.__thread('thread-luna'), window.__thread('thread-two')] })
          if (m.type === 'crossing/model/list') this.emit({ type: 'crossing/models', models: [
            { id: 'luna', model: 'gpt-5.6-luna', displayName: 'Luna fixture', supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', inputModalities: ['text', 'image'], isDefault: true },
            { id: 'terra', model: 'gpt-5.6-terra', displayName: 'Terra fixture', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], defaultReasoningEffort: 'medium', inputModalities: ['text', 'image'] },
          ] })
          if (m.type === 'crossing/model/apply') {
            if (window.__rejectModelApply) this.emit({ type: 'crossing/error', operation: m.type, requestId: m.requestId, code: 'permission_or_auth', error: '测试拒绝模型设置' })
            else {
              window.__pendingModel = { model: m.model, effort: m.effort }
              this.emit({ type: 'crossing/model/pending', requestId: m.requestId, threadId: m.threadId, model: m.model, effort: m.effort })
            }
          }
          if (['crossing/thread/read', 'crossing/thread/resume', 'crossing/thread/start'].includes(m.type)) this.emit({ type: 'crossing/thread', requestId: m.requestId, action: m.type.endsWith('read') ? 'read' : m.type.endsWith('start') ? 'started' : 'resumed', ready: !m.type.endsWith('read'), thread: window.__thread(m.threadId || 'new-thread') })
          if (m.type === 'crossing/turn/start') {
            if (window.__pendingModel) {
              const choice = window.__pendingModel
              localStorage.setItem(`fixture-model-${m.threadId}`, JSON.stringify(choice))
              window.__pendingModel = null
              this.emit({ type: 'crossing/model/confirmed', threadId: m.threadId, model: choice.model, reasoningEffort: choice.effort })
            }
            this.emit({ type: 'crossing/turn/started', threadId: m.threadId, turn: { id: 'fake-turn' } })
            this.emit({ type: 'crossing/message/delta', threadId: m.threadId, turnId: 'fake-turn', itemId: 'stream', delta: 'fixture 流式回复' })
            window.__finishTurn = () => this.emit({ type: 'crossing/turn/completed', threadId: m.threadId, turn: { id: 'fake-turn', status: 'completed' } })
          }
          if (m.type === 'crossing/turn/interrupt') this.emit({ type: 'crossing/turn/completed', threadId: m.threadId, turn: { id: m.turnId, status: 'interrupted' } })
        }, 10)
      }
      close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.() }
    }
    window.WebSocket = FakeSocket
    window.Audio = class {
      constructor() { this.readyState = 1; this.duration = 2; this.played = 0; this.paused = 0; window.__audios.push(this) }
      async play() { this.played++ }
      pause() { this.paused++ }
      removeAttribute() { this.cleaned = true }
      load() {}
    }
  })
  const ready = async () => {
    try { await page.getByRole('button', { name: 'gpt-5.6-luna · low', exact: true }).waitFor({ timeout: 15000 }) }
    catch (error) {
      t.diagnostic(JSON.stringify({ errors, text: (await page.locator('body').innerText()).slice(0, 1200), wire: await page.evaluate(() => (window.__wire || []).map(m => m.type)) }))
      throw error
    }
  }
  await page.goto(origin)
  await page.locator('.home-screen').click()
  await ready()

  const approvalCases = [
    { width: 360, height: 740, visualHeight: 740, safeBottom: 0, choice: 'deny' },
    { width: 412, height: 915, visualHeight: 915, safeBottom: 24, choice: 'allow' },
    { width: 844, height: 390, visualHeight: 390, safeBottom: 0, choice: 'deny' },
    { width: 360, height: 740, visualHeight: 320, offsetTop: 48, safeBottom: 24, choice: 'allow' },
  ]
  for (const [index, fixture] of approvalCases.entries()) {
    await page.evaluate(() => {
      delete visualViewport.height
      delete visualViewport.offsetTop
    })
    await page.setViewportSize({ width: fixture.width, height: fixture.height })
    await page.evaluate(safeBottom => document.documentElement.style.setProperty('--approval-safe-area-bottom', `${safeBottom}px`), fixture.safeBottom)
    await page.evaluate(({ visualHeight, offsetTop = 0, index }) => {
      Object.defineProperty(visualViewport, 'height', { configurable: true, value: visualHeight })
      Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: offsetTop })
      visualViewport.dispatchEvent(new Event('resize'))
      window.__sockets.at(-1).emit({
        type: 'crossing/approval/request', requestId: `approval-${index}`, threadId: 'thread-luna', turnId: 'fixture-turn', itemId: `fixture-item-${index}`,
        kind: 'command', command: Array(80).fill(`printf '很长的授权命令 ${index} /fixture/path/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'`).join('\n'),
        reason: '移动端授权弹窗回归测试', cwd: '/home/ripple/ripple-and-serena',
      })
    }, { visualHeight: fixture.visualHeight, offsetTop: fixture.offsetTop, index })
    const dialog = page.getByRole('dialog', { name: 'Codex 需要本次授权' })
    await dialog.waitFor()
    const geometry = await dialog.evaluate((node, fixture) => {
      const rect = element => element.getBoundingClientRect()
      const backdrop = node.parentElement
      const title = node.querySelector('.crossing-approval-header')
      const body = node.querySelector('.crossing-approval-body')
      const actions = node.querySelector('.crossing-approval-actions')
      const nav = document.querySelector('.icon-nav')
      return {
        modal: rect(node), backdrop: rect(backdrop), title: rect(title), body: rect(body), actions: rect(actions),
        bodyScrolls: body.scrollHeight > body.clientHeight,
        bodyOverflow: getComputedStyle(body).overflowY,
        backdropZ: Number(getComputedStyle(backdrop).zIndex),
        navZ: nav ? Number(getComputedStyle(nav).zIndex) : 0,
        bodyLocked: getComputedStyle(document.body).overflow === 'hidden' && getComputedStyle(document.documentElement).overflow === 'hidden',
        backdropPaddingBottom: parseFloat(getComputedStyle(backdrop).paddingBottom),
        expectedBottom: (fixture.offsetTop || 0) + fixture.visualHeight,
      }
    }, fixture)
    assert.ok(geometry.backdrop.top >= (fixture.offsetTop || 0) - 1)
    assert.ok(geometry.backdrop.bottom <= geometry.expectedBottom + 1)
    assert.ok(geometry.modal.top >= geometry.backdrop.top && geometry.modal.bottom <= geometry.backdrop.bottom)
    assert.ok(geometry.title.top >= geometry.modal.top && geometry.actions.bottom <= geometry.modal.bottom)
    assert.ok(geometry.bodyScrolls, `${fixture.width}x${fixture.height}/${fixture.visualHeight}: only approval body must scroll`)
    assert.equal(geometry.bodyOverflow, 'auto')
    assert.ok(geometry.backdropZ > geometry.navZ)
    assert.equal(geometry.bodyLocked, true)
    assert.ok(geometry.backdropPaddingBottom >= 8 + fixture.safeBottom)
    const button = page.getByRole('button', { name: fixture.choice === 'allow' ? '允许本次' : '拒绝', exact: true })
    assert.ok(await button.evaluate(node => {
      const rect = node.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return rect.height >= 44 && (hit === node || node.contains(hit))
    }))
    await button.click()
    await dialog.waitFor({ state: 'hidden' })
    assert.ok(await page.evaluate(({ index, choice }) => window.__wire.some(message => message.type === 'crossing/approval/respond' && message.requestId === `approval-${index}` && message.choice === choice), { index, choice: fixture.choice }))
  }
  await page.evaluate(() => {
    document.documentElement.style.removeProperty('--approval-safe-area-bottom')
    delete visualViewport.height
    delete visualViewport.offsetTop
    visualViewport.dispatchEvent(new Event('resize'))
  })
  await page.setViewportSize({ width: 360, height: 740 })
  await page.getByRole('button', { name: 'Hollow', exact: true }).click()
  await page.getByRole('button', { name: 'Murmur', exact: true }).click()
  await ready()
  assert.equal(await page.locator('.crossing-panel').count(), 1)
  await page.reload(); await page.locator('.home-screen').click(); await ready()
  await page.evaluate(() => window.__sockets.at(-1).close())
  await page.getByText('重连中', { exact: false }).first().waitFor()
  await ready()
  assert.equal(await page.evaluate(() => window.__wire.filter(m => m.type === 'crossing/thread/resume').length), 2)

  const textarea = page.locator('.crossing-input textarea')
  const themes = ['default', 'qingwu', 'glass', 'custom', 'chensi', 'claude', 'guanduan', 'xilan']
  for (const theme of themes) {
    await page.evaluate(async theme => { const { useStore } = await import('/src/store.js'); useStore.getState().setTheme(theme) }, theme)
    for (const width of [320, 360, 412]) {
      await page.setViewportSize({ width, height: 740 })
      await textarea.fill('一行')
      await textarea.focus()
      const metrics = await textarea.evaluate(node => ({ scroll: node.scrollHeight, client: node.clientHeight, height: node.getBoundingClientRect().height, overflow: getComputedStyle(node).overflowY, before: getComputedStyle(node, '::before').content, after: getComputedStyle(node, '::after').content }))
      assert.ok(metrics.scroll <= metrics.client, `${theme}/${width}: no manufactured scrollbar`)
      assert.ok(metrics.height >= 44 && metrics.height <= 48)
      assert.equal(metrics.overflow, 'hidden')
      assert.ok(['none', 'normal'].includes(metrics.before)); assert.ok(['none', 'normal'].includes(metrics.after))
      await textarea.fill('第一行\n第二行')
      // Even with auto overflow restored, correct sizing needs no thumb.
      assert.ok(await textarea.evaluate(n => { n.style.overflowY = 'auto'; const fits = n.scrollHeight <= n.clientHeight && n.offsetWidth - n.clientWidth <= 2; n.style.overflowY = 'hidden'; return fits }), `${theme}/${width}: multiline fits without concealing overflow`)
      await textarea.fill('一行')
      assert.ok(await page.locator('.crossing-input button').last().evaluate(n => n.offsetWidth >= 64 && n.offsetHeight >= 44))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, value: 380 }); visualViewport.dispatchEvent(new Event('resize')) })
      await page.waitForTimeout(40)
      const geometry = await page.evaluate(() => ['.crossing-panel', '.crossing-layout', '.crossing-chat', '.crossing-input', '.crossing-input textarea'].map(selector => { const n = document.querySelector(selector); const r = n.getBoundingClientRect(), s = getComputedStyle(n); return { selector, top: r.top, bottom: r.bottom, height: r.height, minHeight: s.minHeight, heightRule: s.height, viewport: s.getPropertyValue('--crossing-viewport-height') } }))
      assert.ok(geometry.at(-1).bottom <= 380, `IME visual viewport keeps composer visible: ${JSON.stringify(geometry)}`)
      await textarea.fill(Array(12).fill('长命令 /fixture/path/xxxxxxxxxxxxxxxxxxxxxxxxxxxx').join('\n'))
      assert.ok(await textarea.evaluate(n => n.offsetHeight <= 120 && getComputedStyle(n).overflowY === 'auto'))
      await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')) })
    }
  }
  // Demonstrate the pre-fix calculation produces the reported thumb.
  await textarea.fill('第一行\n第二行')
  const oldOverflow = await textarea.evaluate(n => { n.style.overflowY = 'auto'; n.style.height = 'auto'; n.style.height = `${n.scrollHeight}px`; return n.scrollHeight > n.clientHeight })
  assert.equal(oldOverflow, true)
  await textarea.fill('fixture only')
  assert.equal(await page.locator('.crossing-voice').count(), 0, 'ordinary Agent text stays a text bubble until spoken')
  const speaker = page.locator('.crossing-speech button').first()
  await speaker.click(); await page.getByRole('button', { name: '暂停朗读' }).waitFor()
  assert.equal(await page.locator('.crossing-voice').count(), 1, 'spoken Agent output uses the Murmur voice bar')
  assert.equal(ttsRequests, 1)
  const voicePlay = page.locator('.crossing-voice .vb-play')
  await voicePlay.click(); await page.getByRole('button', { name: '继续朗读' }).waitFor()
  await voicePlay.click(); await page.getByRole('button', { name: '暂停朗读' }).waitFor()
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const streamingSpeech = page.locator('.crossing-speech button').last()
  await streamingSpeech.waitFor()
  assert.equal(await streamingSpeech.isDisabled(), true)
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await page.waitForTimeout(40)
  assert.ok(await page.evaluate(() => window.__audios[0].cleaned))
  assert.ok(await page.evaluate(() => window.__wire.some(m => m.type === 'crossing/turn/interrupt' && m.turnId === 'fake-turn')))
  // A different fixture turn completes normally and enables speech.
  await textarea.fill('second fixture only'); await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByRole('button', { name: '停止', exact: true }).waitFor()
  await page.evaluate(() => window.__finishTurn())
  await page.waitForTimeout(40)
  assert.equal(await streamingSpeech.isDisabled(), false)
  await streamingSpeech.click(); await page.getByRole('button', { name: '暂停朗读' }).waitFor()
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await page.getByRole('button', { name: /Fixture thread-two/ }).click(); await ready()
  assert.ok(await page.evaluate(() => window.__audios.at(-1).cleaned))
  // The actual React cleanup must reject a late synthesis response after unmount.
  delayTts = true
  const createdBefore = await page.evaluate(() => window.__audios.length)
  await page.locator('.crossing-speech button').first().click()
  await page.getByRole('button', { name: '取消朗读加载' }).waitFor()
  await page.getByRole('button', { name: 'Hollow', exact: true }).click()
  await page.getByRole('button', { name: 'Murmur', exact: true }).click(); await ready()
  assert.ok(heldTts)
  await heldTts.fulfill({ json: { audio: 'late-fixture-audio' } }).catch(() => {}) // aborted request
  delayTts = false
  await page.waitForTimeout(40)
  assert.equal(await page.evaluate(() => window.__audios.length), createdBefore)
  failTts = true
  await page.locator('.crossing-speech button').first().click()
  await page.getByRole('button', { name: '朗读失败，点击重试' }).waitFor()
  failTts = false
  await page.getByRole('button', { name: '朗读失败，点击重试' }).click()
  await page.getByRole('button', { name: '暂停朗读' }).waitFor()
  const toolsButton = page.getByRole('button', { name: '工具', exact: true })
  assert.equal(await page.locator('.crossing-tool-links').count(), 0, 'tools are not persistent in the page body')
  await toolsButton.click()
  assert.equal(await page.locator('.crossing-tool-links button').count(), 15)
  await toolsButton.click()
  await page.locator('.crossing-tool-links').waitFor({ state: 'hidden' })
  await toolsButton.click()
  await textarea.click()
  await page.locator('.crossing-tool-links').waitFor({ state: 'hidden' })
  await toolsButton.click()
  await textarea.fill('工具打开前的草稿')
  const toolCases = [
    ['通话记录', '.health-card', '通话记录'],
    ['幸运轮盘', '.fw-modal', '幸运轮盘'],
    ['命运牌阵', '.fate-modal', '命运牌阵'],
    ['塔罗', '.tarot-modal', '苏堤柳塔罗'],
    ['今日签', '.fdl-modal', '今日签'],
  ]
  for (const [name, selector, title] of toolCases) {
    await page.getByRole('button', { name, exact: true }).click()
    await page.locator(selector).waitFor()
    assert.ok((await page.locator(selector).innerText()).includes(title))
    await page.locator(selector).locator('.health-close, .roost-modal-close').click()
    await page.locator(selector).waitFor({ state: 'hidden' })
    assert.equal(await textarea.inputValue(), '工具打开前的草稿')
    assert.ok((await page.locator('.crossing-session.active').innerText()).includes('thread-two'))
  }
  await page.getByRole('button', { name: /语音通话/ }).click()
  assert.ok((await page.getByRole('status').innerText()).includes('并不是当前 Codex Agent'))
  assert.equal(await textarea.inputValue(), '工具打开前的草稿')
  await page.getByRole('button', { name: '知道了', exact: true }).click()

  const turnsBeforeModelCommand = await page.evaluate(() => window.__wire.filter(m => m.type === 'crossing/turn/start').length)
  await textarea.fill(' /MODEL ')
  await page.locator('.crossing-input button').last().click()
  await page.getByLabel('模型').waitFor()
  assert.equal(await page.evaluate(() => window.__wire.filter(m => m.type === 'crossing/turn/start').length), turnsBeforeModelCommand)
  assert.equal(await page.getByText('/MODEL', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'gpt-5.6-luna · low', exact: true }).click()
  await textarea.fill('工具打开前的草稿')

  await page.getByRole('button', { name: 'gpt-5.6-luna · low', exact: true }).click()
  await page.getByLabel('模型').selectOption('gpt-5.6-terra')
  await page.getByRole('button', { name: '下一条起使用', exact: true }).click()
  await page.getByText(/待下一轮应用：gpt-5.6-terra · medium/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'gpt-5.6-luna · low', exact: true }).count(), 1)
  await textarea.fill('切换模型验证')
  await page.locator('.crossing-input button').last().click()
  await page.getByRole('button', { name: 'gpt-5.6-terra · medium', exact: true }).waitFor()
  await page.evaluate(() => window.__finishTurn())
  await page.getByText('Codex 正在工作…').waitFor({ state: 'hidden' })
  await textarea.fill('持续模型验证')
  await page.locator('.crossing-input button').last().click()
  await page.evaluate(() => window.__finishTurn())
  await page.evaluate(() => window.__sockets.at(-1).close())
  await page.getByText('重连中', { exact: false }).first().waitFor()
  await page.getByRole('button', { name: 'gpt-5.6-terra · medium', exact: true }).waitFor()

  await page.getByRole('button', { name: 'gpt-5.6-terra · medium', exact: true }).click()
  await page.getByLabel('模型').selectOption('gpt-5.6-luna')
  await page.evaluate(() => { window.__rejectModelApply = true })
  await page.getByRole('button', { name: '下一条起使用', exact: true }).click()
  await page.getByText(/测试拒绝模型设置.*当前仍为 gpt-5.6-terra · medium/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'gpt-5.6-terra · medium', exact: true }).count(), 1)
  assert.equal(await page.getByText('模型未知', { exact: true }).count(), 0)
  await page.evaluate(() => { window.__rejectModelApply = false })
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('yanji_navigation_v1')).threadId), 'thread-two')
  await page.getByTitle('回到 Murmur', { exact: true }).click()
  await page.getByRole('button', { name: '通话记录', exact: true }).waitFor()
  await page.getByRole('button', { name: '通话记录', exact: true }).evaluate(node => node.click())
  await page.locator('.health-card').waitFor()
  await page.locator('.health-card .health-close').click()
  await page.getByRole('button', { name: 'Hollow', exact: true }).click()
  await page.getByRole('button', { name: 'Murmur', exact: true }).click()
  assert.equal(await page.locator('.crossing-panel').count(), 0)
  await page.reload(); await page.locator('.home-screen').click(); await page.locator('.chat-panel').waitFor()
  assert.equal(await page.locator('.crossing-panel').count(), 0)
  assert.equal(modelRequests, 0, 'no API model call, including dialCall')
  assert.deepEqual(errors, [])
})
