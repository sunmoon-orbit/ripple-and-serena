// 原生壳（言叽 APK）送进来的文字：通知栏快捷回复、系统分享。
//
// 为什么要个队列：MainActivity 在页面加载完就调，那时 React 可能还没挂载，
// 而且 Chat 面板只在 activePanel === 'chat' 时才存在——她停在朋友圈页面时
// handleSend 根本不在。所以原生那边先把话放这儿，Chat 一挂载就来取。
//
// 0726 之前原生调的是 `window.__yanjiShareText && window.__yanjiShareText(t)`，
// 前端从来没定义过这个函数，短路让分享进来的文字安静地掉了大半个月。
// 教训：跨端的桥两头要一起写，「函数存在才调」的写法会把没接上的那半边藏起来。

const queue = []

export function pushNative(item) {
  queue.push(item)
  window.dispatchEvent(new Event('yanji-native-text'))
}

// 取走全部待处理项（取一次就清空，别重复发）
export function drainNative() {
  return queue.splice(0)
}
