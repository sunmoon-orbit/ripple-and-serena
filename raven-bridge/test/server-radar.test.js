const test = require('node:test')
const assert = require('node:assert/strict')
const { parsePlans, judge, itemsOfRss } = require('../server-radar.js')

const LEB_POST = `<p>RackNerd is back with Black Friday deals!</p>
<h3>2 GB KVM VPS</h3><ul><li>2 vCPU Cores</li><li>40 GB SSD Storage</li><li>2 GB RAM</li><li>$18.66/year</li></ul>
<a href="https://my.racknerd.com/aff.php?aff=1234&amp;pid=901">ORDER HERE</a>
<h3>4 GB KVM VPS</h3><ul><li>3 vCPU Cores</li><li>65 GB SSD Storage</li><li>4.5 GB RAM</li><li>Locations: Los Angeles, San Jose, New York</li><li>$29.98/year</li></ul>
<a href="https://my.racknerd.com/aff.php?aff=1234&amp;pid=902">ORDER HERE</a>
<h3>8 GB KVM VPS</h3><ul><li>6 vCPU Cores</li><li>150 GB SSD Storage</li><li>8 GB RAM</li><li>$59.99/year</li></ul>
<a href="https://my.racknerd.com/aff.php?aff=1234&amp;pid=903">ORDER HERE</a>
<h3>4 GB KVM VPS — Chicago only</h3><ul><li>60 GB SSD Storage</li><li>4 GB RAM</li><li>Chicago</li><li>$25/year</li></ul>
<a href="https://my.racknerd.com/aff.php?aff=1234&amp;pid=904">ORDER HERE</a>`

test('LowEndBox style post: each order link takes the block before it', () => {
  const plans = parsePlans(LEB_POST, { name: 'leb', url: 'x' })
  assert.deepEqual(plans.map(p => [p.pid, p.ram, p.disk, p.usd]), [
    ['901', 2, 40, 18.66], ['902', 4.5, 65, 29.98], ['903', 8, 150, 59.99], ['904', 4, 60, 25],
  ])
  assert.equal(plans[1].location, 'west')
  assert.equal(plans[3].location, 'other')
  assert.equal(plans[1].link, 'https://my.racknerd.com/cart.php?a=add&pid=902')
})

test('budget tiers follow her 350 / 450 line', () => {
  const plans = parsePlans(LEB_POST, { name: 'leb', url: 'x' })
  assert.equal(judge(plans[0]), null)                       // 2G 太小
  assert.deepEqual(judge(plans[1]), { cny: 214, tier: 'ok' })
  assert.deepEqual(judge(plans[2]), { cny: 429, tier: 'stretch' })
  assert.equal(judge(plans[3]), null)                       // 只有芝加哥
  assert.equal(judge({ ram: 4, disk: 60, usd: 70, location: 'unknown' }), null) // 超 450
  assert.equal(judge({ ram: 4, disk: 40, usd: 20, location: 'west' }), null)    // 硬盘不够
})

test('rss items expose CDATA body', () => {
  const xml = `<rss><channel><item><title>RackNerd BF</title><link>https://lowendbox.com/a</link><content:encoded><![CDATA[${LEB_POST}]]></content:encoded></item></channel></rss>`
  const [item] = itemsOfRss(xml)
  assert.equal(item.title, 'RackNerd BF')
  assert.equal(parsePlans(item.body, {}).length, 4)
})
