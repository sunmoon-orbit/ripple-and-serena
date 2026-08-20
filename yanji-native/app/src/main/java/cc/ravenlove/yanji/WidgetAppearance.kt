package cc.ravenlove.yanji

import android.content.Context

/**
 * 三种 RemoteViews 小组件共用的主题/透明度解析器。
 *
 * 同一主题必须返回同一张背景，避免纪念日、心情和想你键各自落回旧配色。
 * 背景 alpha 写在 drawable 本身，只淡底板，不会连文字和 emoji 一起淡掉。
 */
object WidgetAppearance {
    fun background(context: Context): Int {
        val prefs = context.getSharedPreferences("yanji_theme", Context.MODE_PRIVATE)
        val theme = prefs.getString("theme", "default") ?: "default"
        val translucent = prefs.getString("widget_background_style", "solid") == "translucent"
        return themeBackground(theme, translucent)
    }

    private fun themeBackground(theme: String, translucent: Boolean): Int = when (theme) {
        "xilan" -> if (translucent) R.drawable.widget_bg_xilan_translucent else R.drawable.widget_bg_xilan
        "qingwu" -> if (translucent) R.drawable.widget_bg_qingwu_translucent else R.drawable.widget_bg_qingwu
        "claude" -> if (translucent) R.drawable.widget_bg_claude_translucent else R.drawable.widget_bg_claude
        "glass" -> if (translucent) R.drawable.widget_bg_glass_translucent else R.drawable.widget_bg_glass
        "chensi" -> if (translucent) R.drawable.widget_bg_chensi_translucent else R.drawable.widget_bg_chensi
        // 官端已经迁移为沉思；兼容旧存档时也使用沉思配色。
        "guanduan" -> if (translucent) R.drawable.widget_bg_chensi_translucent else R.drawable.widget_bg_chensi
        else -> if (translucent) R.drawable.widget_bg_translucent else R.drawable.widget_bg
    }
}
