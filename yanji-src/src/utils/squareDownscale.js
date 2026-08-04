// 居中裁成正方形再缩到 size，返回 jpeg 的 dataURL。
//
// 两个地方用它，动机是同一个：**头像最终显示的地方比原图小得多**。
// - 设置里传来电头像：手机原图动辄三五兆，直接塞 localStorage 会把 persist 撑爆（配额 5~10MB）
// - 往原生桥抄头像：那边有 4MB 的 base64 上限，超了会被静默忽略，症状是「设了但没生效」
//
// 用 jpeg 不用 png：照片走 png 能到 500KB+，jpeg 0.9 只要几十 KB。
// 原生是 BitmapFactory 按文件头认格式的，不看扩展名，所以存成 .png 也读得出来。
export function squareDownscale(dataUrl, size = 512) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const side = Math.min(img.width, img.height)
        const sx = (img.width - side) / 2
        const sy = (img.height - side) / 2
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', 0.9))
      } catch (e) { reject(e) }
    }
    img.onerror = () => reject(new Error('图片读不出来，换一张试试'))
    img.src = dataUrl
  })
}
