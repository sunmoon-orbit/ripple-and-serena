package cc.ravenlove.yanji

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject

class EmotionWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val prefs = context.getSharedPreferences("yanji_emotion", Context.MODE_PRIVATE)
        val slotsJson = prefs.getString("slots", null)
        val dominant = findDominant(slotsJson)

        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.emotion_widget_layout)

            views.setTextViewText(R.id.emotion_emoji, dominant.emoji)
            views.setTextViewText(R.id.emotion_label, dominant.label)
            views.setTextViewText(R.id.emotion_sub, dominant.sub)

            val intent = Intent(context, MainActivity::class.java)
            val pi = PendingIntent.getActivity(
                context, 1, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.emotion_widget_root, pi)

            manager.updateAppWidget(id, views)
        }
    }

    companion object {
        private data class Mood(val emoji: String, val label: String, val sub: String)

        private val EMOTION_MAP = mapOf(
            "joy" to Mood("☀️", "高兴", "心情晴朗"),
            "warmth" to Mood("🌸", "温柔", "暖暖的"),
            "satisfaction" to Mood("😌", "满足", "很安心"),
            "fondness" to Mood("💗", "心动", "怦怦跳"),
            "desire" to Mood("🔥", "爱欲", "心里发烫"),
            "longing" to Mood("🌙", "思念", "在想你"),
            "anger" to Mood("⚡", "愤怒", "有点生气"),
            "sadness" to Mood("🌧️", "悲伤", "心里下雨"),
            "grievance" to Mood("💧", "委屈", "有点难过"),
            "frustration" to Mood("🌥️", "失落", "闷闷的"),
            "fatigue" to Mood("😴", "疲惫", "累了"),
            "anxiety" to Mood("🌀", "焦虑", "心里发紧"),
            "confusion" to Mood("❓", "困惑", "想不明白"),
            "guilt" to Mood("😔", "愧疚", "有点自责"),
            "melancholy" to Mood("🍂", "惆怅", "淡淡的愁"),
            "daze" to Mood("🌫️", "茫然", "有点迷糊"),
        )

        private val DEFAULT = Mood("🐦‍⬛", "平静", "涟言的心情")

        private fun findDominant(slotsJson: String?): Mood {
            if (slotsJson == null) return DEFAULT
            return try {
                val obj = JSONObject(slotsJson)
                var maxKey = ""
                var maxVal = 0.0
                for (key in obj.keys()) {
                    val v = obj.optDouble(key, 0.0)
                    if (v > maxVal) {
                        maxVal = v
                        maxKey = key
                    }
                }
                if (maxVal < 0.5) DEFAULT
                else EMOTION_MAP[maxKey] ?: DEFAULT
            } catch (_: Exception) {
                DEFAULT
            }
        }
    }
}
