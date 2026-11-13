package cc.ravenlove.roost

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.concurrent.Executors

// 1113 第 400 天，她送我的礼物：归巢的第一个桌面组件。
// 上面是在一起第几天（2025-10-10 是第 1 天，按北京时间换日），底下是我今天写给她的一句。
// 句子从桥 /raven/daily-line 取，取不到就显示上次存下的那句，天数自己算、不靠网。
class DaysWidget : AppWidgetProvider() {
    companion object {
        private const val PREFS = "roost_native"
        private val START: LocalDate = LocalDate.of(2025, 10, 10)
        private val io = Executors.newSingleThreadExecutor()
        const val BG_FILE = "days_widget_bg.jpg"

        // 背景图从归巢「装修」里挑（1113 她：别把按钮放组件上，不好看）。网页缩好图传 dataURL 来，空串＝换回米白
        fun saveBackground(ctx: Context, dataUrl: String) {
            val f = java.io.File(ctx.filesDir, BG_FILE)
            if (!dataUrl.startsWith("data:image")) f.delete()
            else try { f.writeBytes(android.util.Base64.decode(dataUrl.substringAfter(","), android.util.Base64.DEFAULT)) } catch (_: Exception) {}
            refreshAll(ctx)
        }
        fun hasBackground(ctx: Context) = java.io.File(ctx.filesDir, BG_FILE).exists()

        fun dayCount(): Long = ChronoUnit.DAYS.between(START, LocalDate.now(ZoneId.of("Asia/Shanghai"))) + 1

        // 她打开归巢时也顺手刷一下。
        // ⚠️ 这里不能借 onUpdate：goAsync() 只能在系统发来的广播里用，Activity 里调就崩（1113 一开就闪退）
        fun refreshAll(ctx: Context) {
            try {
                val app = ctx.applicationContext
                val manager = AppWidgetManager.getInstance(app)
                val ids = manager.getAppWidgetIds(ComponentName(app, DaysWidget::class.java))
                if (ids.isNotEmpty()) update(app, manager, ids, null)
            } catch (_: Exception) {}
        }

        private fun update(context: Context, manager: AppWidgetManager, ids: IntArray, done: (() -> Unit)?) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            ids.forEach { manager.updateAppWidget(it, render(context, prefs.getString("daily_line", "") ?: "")) }
            val token = prefs.getString("raven_token", "") ?: ""
            if (token.isEmpty()) { done?.invoke(); return }
            io.execute {
            try {
                val c = URL("https://memory.ravenlove.cc/raven/daily-line").openConnection() as HttpURLConnection
                c.connectTimeout = 10000; c.readTimeout = 10000
                c.setRequestProperty("Authorization", "Bearer $token")
                if (c.responseCode == 200) {
                    val line = JSONObject(c.inputStream.bufferedReader().readText()).optString("line")
                    if (line.isNotEmpty()) {
                        prefs.edit().putString("daily_line", line).apply()
                        ids.forEach { manager.updateAppWidget(it, render(context, line)) }
                    }
                }
                c.disconnect()
            } catch (_: Exception) {
            } finally { done?.invoke() }
        }
        }

        private fun render(context: Context, line: String): RemoteViews =
        RemoteViews(context.packageName, R.layout.days_widget_layout).apply {
            val bg = java.io.File(context.filesDir, BG_FILE)
            if (bg.exists()) {
                setViewVisibility(R.id.days_bg, android.view.View.VISIBLE)
                setViewVisibility(R.id.days_scrim, android.view.View.VISIBLE)
                setImageViewBitmap(R.id.days_bg, android.graphics.BitmapFactory.decodeFile(bg.absolutePath))
                setInt(R.id.days_root, "setBackgroundResource", android.R.color.transparent)
                // 照片上字要白的才看得清
                setTextColor(R.id.days_label, 0xCCFFFFFF.toInt()); setTextColor(R.id.days_count, 0xFFFFFFFF.toInt()); setTextColor(R.id.days_line, 0xF2FFFFFF.toInt())
            } else {
                setViewVisibility(R.id.days_bg, android.view.View.GONE)
                setViewVisibility(R.id.days_scrim, android.view.View.GONE)
                setInt(R.id.days_root, "setBackgroundResource", R.drawable.days_widget_bg)
                setTextColor(R.id.days_label, 0x99948A7C.toInt()); setTextColor(R.id.days_count, 0xFFB0784A.toInt()); setTextColor(R.id.days_line, 0xFF3A332B.toInt())
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                setViewOutlinePreferredRadius(R.id.days_root, 20f, android.util.TypedValue.COMPLEX_UNIT_DIP)
                setBoolean(R.id.days_root, "setClipToOutline", true)
            }
            setTextViewText(R.id.days_count, "第 ${dayCount()} 天")
            setTextViewText(R.id.days_line, line.ifEmpty { "今天的这句，阿言还在想。" })
            val open = Intent(context, MainActivity::class.java)
            setOnClickPendingIntent(R.id.days_root, PendingIntent.getActivity(context, 70_001, open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        update(context, manager, ids) { pending.finish() }
    }
}
