// 一根羽毛（内联 SVG，开屏和密码门共用同一根——开屏飘落的就是门口躺着的这根）
// currentColor 上色，跟主题的 --ink 走；羽轴和羽枝缺口用 --bg 刻出来
export default function Feather({ className }) {
  return (
    <svg className={className} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* 羽片 */}
      <path
        d="M54 6C40 5 21 20 12.5 43.5 10.6 49 9.4 54.6 10.4 55.6 11.4 56.6 17 55.4 22.5 53.5 46 45 57.5 26 56.5 11.5 56.3 8.5 55.5 6.1 54 6Z"
        fill="currentColor"
      />
      {/* 羽轴 */}
      <path d="M51 11C40 22 27 36 13 53" stroke="var(--bg, #fff)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      {/* 羽枝缺口 */}
      <path d="M40 17l-9 5M46 24l-10 6M35 33l-8 6M42 38l-7 5" stroke="var(--bg, #fff)" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      {/* 笔尖尾杆 */}
      <path d="M13 53l-5.5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  )
}
