// 一根羽毛（内联 SVG，开屏和密码门共用同一根——开屏飘落的就是门口躺着的这根）
// 一根饱满、柔软的小羽毛：靠不规则轮廓表现羽绒，不画叶脉或鱼骨。
export default function Feather({ className }) {
  return (
    <svg className={className} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="feather-wash" x1="12" y1="54" x2="53" y2="7" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity="0.58" />
          <stop offset="0.55" stopColor="currentColor" stopOpacity="0.86" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.46" />
        </linearGradient>
      </defs>
      {/* 宽而不对称的羽片，轮廓上的折点是自然分开的羽绒。 */}
      <path
        className="feather-vane"
        d="M53.7 6.8C43.2 5.9 28.7 14.4 19.8 27.2c-5.4 7.7-8.8 16.4-9.2 25.2-.1 2.2.5 3.3 1.7 3.2 3.7-.2 8.5-2.1 13.4-5.1l-3.8.3c4.8-2.5 8.8-5.2 12.3-8.4l-3.6.8c4.5-3.5 8.3-7.7 11.3-12.2l-3.2 1.4c4.1-5.4 6.8-10.8 8.1-15.7l-2.2 2c2.8-5.1 4.3-8.2 9.1-11.9Z"
        fill="url(#feather-wash)"
      />
      {/* 羽轴和尾杆是一条连续的、略带粗细变化的曲线。 */}
      <path className="feather-shaft" d="M51.5 10.4C42.1 20.4 31 33.4 12.3 54.8l-4.9 4.6" fill="none" stroke="currentColor" strokeLinecap="round" />
      <path className="feather-shine" d="M49.4 12.8C39.7 23.2 28.2 36.4 14.3 52.5" fill="none" stroke="var(--bg, #fff)" strokeLinecap="round" />
    </svg>
  )
}
