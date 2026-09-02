package cc.ravenlove.yanji

import android.content.Context
import android.graphics.BitmapFactory
import android.os.Build
import android.util.TypedValue
import android.view.View
import android.appwidget.AppWidgetManager
import android.widget.RemoteViews
import java.io.File

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

    fun apply(
        context: Context,
        views: RemoteViews,
        rootId: Int,
        imageId: Int,
        manager: AppWidgetManager? = null,
        appWidgetId: Int? = null
    ) {
        val prefs = context.getSharedPreferences("yanji_theme", Context.MODE_PRIVATE)
        val imageMode = prefs.getString("widget_background_style", "solid") == "image"
        val file = File(context.filesDir, "widget_background.jpg")
        if (imageMode && file.exists()) {
            views.setInt(rootId, "setBackgroundResource", android.R.color.transparent)
            views.setViewVisibility(imageId, View.VISIBLE)
            views.setImageViewBitmap(imageId, BitmapFactory.decodeFile(file.absolutePath))
        } else {
            views.setViewVisibility(imageId, View.GONE)
            views.setInt(rootId, "setBackgroundResource", background(context))
        }

        // Launcher hosts do not always respect a drawable's corners after stretching a
        // RemoteViews widget. Give the host an explicit outline and clip custom photos too.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val radius = if (manager != null && appWidgetId != null && isLarge(manager, appWidgetId)) 30f else 22f
            views.setViewOutlinePreferredRadius(rootId, radius, TypedValue.COMPLEX_UNIT_DIP)
            views.setBoolean(rootId, "setClipToOutline", true)
            views.setViewOutlinePreferredRadius(imageId, radius, TypedValue.COMPLEX_UNIT_DIP)
            views.setBoolean(imageId, "setClipToOutline", true)
        }
    }

    fun isLarge(manager: AppWidgetManager, appWidgetId: Int): Boolean {
        val options = manager.getAppWidgetOptions(appWidgetId)
        val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
        val height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
        return width >= 220 || height >= 170
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
