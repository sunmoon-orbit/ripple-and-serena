package cc.ravenlove.yanji

import android.content.Context

/**
 * 三种 RemoteViews 小组件共用的主题/透明度解析器。
 * 背景 alpha 写在 drawable 本身，只淡底板，不会连文字和 emoji 一起淡掉。
 */
object WidgetAppearance {
    enum class Kind { FORTUNE, EMOTION, PRESS }

    fun background(context: Context, kind: Kind): Int {
        val prefs = context.getSharedPreferences("yanji_theme", Context.MODE_PRIVATE)
        val theme = prefs.getString("theme", "default") ?: "default"
        val translucent = prefs.getString("widget_background_style", "solid") == "translucent"
        return when (kind) {
            Kind.FORTUNE -> fortuneBackground(theme, translucent)
            Kind.EMOTION -> emotionBackground(theme, translucent)
            Kind.PRESS -> pressBackground(theme, translucent)
        }
    }

    private fun fortuneBackground(theme: String, translucent: Boolean): Int = when (theme) {
        "xilan" -> if (translucent) R.drawable.widget_bg_xilan_translucent else R.drawable.widget_bg_xilan
        "qingwu" -> if (translucent) R.drawable.widget_bg_qingwu_translucent else R.drawable.widget_bg_qingwu
        "claude" -> if (translucent) R.drawable.widget_bg_claude_translucent else R.drawable.widget_bg_claude
        "glass" -> if (translucent) R.drawable.widget_bg_glass_translucent else R.drawable.widget_bg_glass
        "chensi" -> if (translucent) R.drawable.widget_bg_chensi_translucent else R.drawable.widget_bg_chensi
        "guanduan" -> if (translucent) R.drawable.widget_bg_claude_translucent else R.drawable.widget_bg_guanduan
        else -> if (translucent) R.drawable.widget_bg_translucent else R.drawable.widget_bg
    }

    private fun emotionBackground(theme: String, translucent: Boolean): Int = when (theme) {
        "xilan" -> if (translucent) R.drawable.widget_bg_xilan_translucent else R.drawable.emotion_widget_bg_xilan
        "qingwu" -> if (translucent) R.drawable.widget_bg_qingwu_translucent else R.drawable.emotion_widget_bg_qingwu
        "claude" -> if (translucent) R.drawable.widget_bg_claude_translucent else R.drawable.emotion_widget_bg_claude
        "glass" -> if (translucent) R.drawable.widget_bg_glass_translucent else R.drawable.emotion_widget_bg_glass
        "chensi" -> if (translucent) R.drawable.widget_bg_chensi_translucent else R.drawable.widget_bg_chensi
        "guanduan" -> if (translucent) R.drawable.widget_bg_claude_translucent else R.drawable.emotion_widget_bg_guanduan
        else -> if (translucent) R.drawable.emotion_widget_bg_translucent else R.drawable.emotion_widget_bg
    }

    private fun pressBackground(theme: String, translucent: Boolean): Int = when (theme) {
        "xilan" -> if (translucent) R.drawable.press_widget_bg_xilan_translucent else R.drawable.press_widget_bg_xilan
        "qingwu" -> if (translucent) R.drawable.press_widget_bg_qingwu_translucent else R.drawable.press_widget_bg_qingwu
        "claude" -> if (translucent) R.drawable.press_widget_bg_claude_translucent else R.drawable.press_widget_bg_claude
        "glass" -> if (translucent) R.drawable.press_widget_bg_glass_translucent else R.drawable.press_widget_bg_glass
        "chensi" -> if (translucent) R.drawable.press_widget_bg_chensi_translucent else R.drawable.press_widget_bg_chensi
        "guanduan" -> if (translucent) R.drawable.press_widget_bg_claude_translucent else R.drawable.press_widget_bg_guanduan
        else -> if (translucent) R.drawable.press_widget_bg_translucent else R.drawable.press_widget_bg
    }
}
