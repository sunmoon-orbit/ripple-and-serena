// 手绘风小天气图标（阿颖的愿望：太阳画小太阳，小雨画云朵滴雨滴，2026-07-16）
// 描边风格和全站 feather 图标一致；icon 键与 moon-memory /weather 返回的 icon 字段对应。

const CLOUD = 'M17.5 19H9a6 6 0 1 1 .6-11.97A6.5 6.5 0 0 1 22 9.5a4.75 4.75 0 0 1-4.5 9.5z'
// 云稍微抬高一点的变体，给下面留出雨滴/雪花的位置
const CLOUD_HIGH = 'M17 15.5H8.5A5 5 0 1 1 9 5.53 5.6 5.6 0 0 1 20.5 7.6a4 4 0 0 1-3.5 7.9z'

const PARTS = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" />
    </>
  ),
  'cloud-sun': (
    <>
      <circle cx="7.5" cy="7" r="2.6" />
      <path d="M7.5 2.2v1.4M2.7 7h1.4M4.1 3.6l1 1M10.9 3.6l-1 1" />
      <path d="M14.5 21H8.8a4.4 4.4 0 1 1 .5-8.77A5 5 0 0 1 19 14.2a3.5 3.5 0 0 1-4.5 6.8z" />
    </>
  ),
  cloud: <path d={CLOUD} />,
  'rain-light': (
    <>
      <path d={CLOUD_HIGH} />
      <path d="M9 18.5l-.6 1.6M13.5 18.5l-.6 1.6" />
    </>
  ),
  rain: (
    <>
      <path d={CLOUD_HIGH} />
      <path d="M8 18l-1 2.6M12.5 18l-1 2.6M17 18l-1 2.6" />
    </>
  ),
  storm: (
    <>
      <path d={CLOUD_HIGH} />
      <path d="M12.5 17l-2.2 3.2h3l-2.2 3.2" />
    </>
  ),
  snow: (
    <>
      <path d={CLOUD_HIGH} />
      <path d="M8.5 18.7h.01M12.5 20h.01M16.5 18.7h.01" strokeWidth="2.4" />
    </>
  ),
  fog: (
    <>
      <path d={CLOUD_HIGH} />
      <path d="M7 18.5h11M9 21.2h8" />
    </>
  ),
  haze: (
    <>
      <path d="M16.5 12.5a4.5 4.5 0 0 0-9 0" />
      <path d="M12 4.5v2M5.3 7.3l1.4 1.4M18.7 7.3l-1.4 1.4M3 16h18M6 19.2h12" />
    </>
  ),
}

export default function WeatherIcon({ icon = 'cloud-sun', size = 16, style }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      style={{ verticalAlign: '-2px', ...style }}
    >
      {PARTS[icon] || PARTS['cloud-sun']}
    </svg>
  )
}
