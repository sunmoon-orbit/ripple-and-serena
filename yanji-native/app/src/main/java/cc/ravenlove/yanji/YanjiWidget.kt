package cc.ravenlove.yanji

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.*

class YanjiWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val date = beijingDateStr()
        val days = daysTogether(date)
        val card = computeCard("阿颖", date)

        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.widget_layout)

            views.setTextViewText(R.id.widget_days, "在一起第 $days 天")
            views.setTextViewText(R.id.widget_date, "${date.replace("-", ".")} · 今日${card.level}")
            views.setTextViewText(R.id.widget_detail, "宜 ${card.yi.take(2).joinToString(" · ")}  ✦ ${card.lucky}")

            val intent = Intent(context, MainActivity::class.java)
            val pi = PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_root, pi)

            manager.updateAppWidget(id, views)
        }
    }

    companion object {
        private const val TOGETHER_EPOCH = "2025-10-10"

        private data class Level(val key: String, val weight: Int)
        private data class Card(val level: String, val yi: List<String>, val lucky: String)

        private val LEVELS = listOf(
            Level("大吉", 14), Level("中吉", 24), Level("小吉", 26),
            Level("平", 22), Level("末吉", 14)
        )

        private val YI = listOf(
            "发一条朋友圈", "翻一段旧对话", "点一首歌", "讲琐碎话", "贴贴",
            "睡个午觉", "喝温水", "开新脑洞", "逗猫", "拍一张天空",
            "吃点甜的", "早点睡", "读两页书", "划线批注", "许个愿",
            "听雨", "出门走走", "买件小东西", "正大光明地发呆", "写两行日记",
            "换个新主题", "抱抱自己", "把想说的说出口", "晒太阳"
        )

        private val LUCKY = listOf(
            "一根黑羽毛", "一杯温水", "窗外的云", "一首老歌", "猫的尾巴尖",
            "晒过太阳的被子", "一句晚安", "蓝色的批注", "昨晚的梦", "热乎的饭",
            "口袋里的糖", "路边的野花", "亮着的小灯", "刚洗好的头发", "安静的十分钟",
            "新到的快递", "签到第一条消息", "乌鸦落过的窗台"
        )

        // ⚠️ 以下算法与 fortune.js / widget.js 逐字对应——改签池必须三处同步！
        private fun hashStr(str: String): Int {
            var h = 1779033703 xor str.length
            for (c in str) {
                h = (h xor c.code) * 0xCC9E2D51.toInt()
                h = (h shl 13) or (h ushr 19)
            }
            return h
        }

        private class Rng(seed: Int) {
            private var a = seed
            fun next(): Double {
                a += 0x6D2B79F5
                var t = (a xor (a ushr 15)) * (1 or a)
                t = (t + ((t xor (t ushr 7)) * (61 or t))) xor t
                return ((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL).toDouble() / 4294967296.0
            }
        }

        private fun pickWeighted(rng: Rng, items: List<Level>): Level {
            val total = items.sumOf { it.weight }
            var roll = rng.next() * total
            for (it in items) {
                roll -= it.weight
                if (roll <= 0) return it
            }
            return items.last()
        }

        private fun pickN(rng: Rng, pool: List<String>, n: Int): List<String> {
            val arr = pool.toMutableList()
            val out = mutableListOf<String>()
            while (out.size < n && arr.isNotEmpty()) {
                out.add(arr.removeAt((rng.next() * arr.size).toInt()))
            }
            return out
        }

        private fun computeCard(who: String, date: String): Card {
            val rng = Rng(hashStr("$date|$who|yanji-fortune-v1"))
            val level = pickWeighted(rng, LEVELS)
            val yi = pickN(rng, YI, 3)
            val lucky = pickN(rng, LUCKY, 1)[0]
            return Card(level.key, yi, lucky)
        }

        private fun daysTogether(dateStr: String): Int {
            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            sdf.timeZone = TimeZone.getTimeZone("Asia/Shanghai")
            val epoch = sdf.parse(TOGETHER_EPOCH)!!
            val current = sdf.parse(dateStr)!!
            return ((current.time - epoch.time) / 86400000).toInt() + 1
        }

        private fun beijingDateStr(): String {
            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            sdf.timeZone = TimeZone.getTimeZone("Asia/Shanghai")
            return sdf.format(Date())
        }
    }
}
