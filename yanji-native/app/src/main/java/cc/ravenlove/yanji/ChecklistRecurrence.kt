package cc.ravenlove.yanji

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/**
 * Native widget-side daily recurrence.
 *
 * The checklist API remains the source of truth for each day's visible rows, so the web app
 * and chat tool keep seeing the same checklist. Only the small recurring template is stored
 * locally; the widget materializes one fresh row on the first refresh of a new day.
 */
object ChecklistRecurrence {
    private const val PREFS = "yanji_checklist_recurrence"
    private const val KEY_TEMPLATES = "templates"

    fun add(context: Context, text: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        val today = LocalDate.now().toString()
        val items = read(context)
        val existing = items.indexOfFirst { it.optString("text") == clean }
        val row = JSONObject().put("text", clean).put("last_day", today)
        if (existing >= 0) items[existing] = row else items += row
        write(context, items)
    }

    fun contains(context: Context, text: String): Boolean =
        read(context).any { it.optString("text") == text }

    fun texts(context: Context): List<String> = read(context)
        .map { it.optString("text").trim() }
        .filter { it.isNotEmpty() }

    fun remove(context: Context, text: String) {
        write(context, read(context).filterNot { it.optString("text") == text })
    }

    fun materializeToday(context: Context) {
        val today = LocalDate.now().toString()
        val items = read(context)
        var changed = false
        for (item in items) {
            if (item.optString("last_day") == today) continue
            val text = item.optString("text").trim()
            if (text.isEmpty()) continue
            try {
                WidgetApi.request(context, "/checklist", "POST", JSONObject()
                    .put("text", text)
                    .put("added_by", "阿颖"))
                item.put("last_day", today)
                changed = true
            } catch (_: Exception) {
                // Keep last_day unchanged so a later widget refresh can retry safely.
            }
        }
        if (changed) write(context, items)
    }

    private fun read(context: Context): MutableList<JSONObject> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_TEMPLATES, "[]") ?: "[]"
        val array = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
        return MutableList(array.length()) { array.optJSONObject(it) ?: JSONObject() }
    }

    private fun write(context: Context, items: List<JSONObject>) {
        val array = JSONArray()
        items.forEach(array::put)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_TEMPLATES, array.toString()).apply()
    }
}
