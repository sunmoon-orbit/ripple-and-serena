// 一根羽毛（内联 SVG，开屏和密码门共用同一根——开屏飘落的就是门口躺着的这根）
// 不再用一整块实心剪影：淡羽片托底，羽轴与一束束羽枝叠出柔软的纤维感。
export default function Feather({ className }) {
  return (
    <svg className={className} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="feather-wash" x1="12" y1="54" x2="53" y2="7" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="0.58" stopColor="currentColor" stopOpacity="0.42" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      {/* 一层很薄的羽片底色，边缘刻意留出几处细小缺口。 */}
      <path
        className="feather-vane"
        d="M53.8 6.8C43.2 5.7 29.1 14.8 20 27.1c-5.6 7.6-9.6 16.3-9.5 24.8.1 2.2.7 3.4 1.8 3.5 7.7.7 17.2-3 25-8.1 12.4-8.1 19.5-21.2 19.2-34.4-.1-3.3-.9-4.3-2.7-4.1Z"
        fill="url(#feather-wash)"
      />
      <g className="feather-fibres" fill="none" stroke="currentColor" strokeLinecap="round">
        {/* 羽枝并非严格对称，长短和透明度略有变化才像自然生长。 */}
        <path d="M46.8 13.7 35.4 16.2M43.5 17.4 29.7 21M39.7 21.5 25.4 25.8M35.8 25.7 21.3 30.8M31.9 30 17.9 35.9M27.8 34.5 15.2 40.7M23.8 39 12.9 45.2" />
        <path d="M49.1 15.2 51.6 24.5M45.4 19.1 48.8 30M41.7 23.1 45.1 35.1M37.8 27.3 40.6 39.8M33.8 31.5 36 44M29.7 36 31 47.8M25.4 40.7 25.7 50.6" />
      </g>
      {/* 羽轴和尾杆是一条连续的、略带粗细变化的曲线。 */}
      <path className="feather-shaft" d="M52 10.2C42.4 20.2 31 33.1 12.2 54.8L7.4 59.4" fill="none" stroke="currentColor" strokeLinecap="round" />
      <path className="feather-shine" d="M49.8 12.3C39.8 22.9 28.2 36.3 14.2 52.4" fill="none" stroke="var(--bg, #fff)" strokeLinecap="round" />
    </svg>
  )
}
