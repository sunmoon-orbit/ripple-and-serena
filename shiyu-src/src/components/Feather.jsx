// 一根羽毛（内联 SVG，开屏和密码门共用同一根——开屏飘落的就是门口躺着的这根）
// 一根柔软的小羽毛：不画整排羽枝，避免变成叶脉或鱼骨。
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
      {/* 不对称的薄羽片，轮廓留几处天然的小豁口。 */}
      <path
        className="feather-vane"
        d="M53.4 7.1c-8.7-1.2-20 5.3-28.5 15.1-7.4 8.5-12 18-13.4 28.2-.4 2.7-.1 4.3.9 4.7 2.1.8 7.7-.9 13.9-4.4l-3.2-.1c5-2.6 8.8-5.2 12.3-8.5l-3.1.8c4.1-3.5 7.7-7.8 10.6-12.3l-2.5 1.1c4-5.7 6.2-10.8 7.4-15.5l-1.8 1.5c2.2-4.9 1.5-9.9-2.6-10.6Z"
        fill="url(#feather-wash)"
      />
      <g className="feather-fibres" fill="none" stroke="var(--bg, #fff)" strokeLinecap="round">
        {/* 只露三缕弯曲的纤维，像光从羽片间透过去。 */}
        <path d="M38.8 20.4c-4.7 1.1-8.8 3-12.5 5.5M31.2 29.4c-4.5 1.7-8.2 4-11.4 7M24.6 38.5c-3.1 1.7-5.7 3.7-7.8 5.9" />
      </g>
      {/* 羽轴和尾杆是一条连续的、略带粗细变化的曲线。 */}
      <path className="feather-shaft" d="M51.5 10.4C42.1 20.4 31 33.4 12.3 54.8l-4.9 4.6" fill="none" stroke="currentColor" strokeLinecap="round" />
      <path className="feather-shine" d="M49.4 12.8C39.7 23.2 28.2 36.4 14.3 52.5" fill="none" stroke="var(--bg, #fff)" strokeLinecap="round" />
    </svg>
  )
}
