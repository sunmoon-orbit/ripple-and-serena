package cc.ravenlove.yanji

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.widget.EditText
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class WidgetComposeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mode = intent.getStringExtra(EXTRA_MODE) ?: run { finish(); return }
        val input = EditText(this).apply {
            hint = if (mode == MODE_CHECKLIST) "今天要做什么？" else "写一张便利贴……"
            setPadding(44, 28, 44, 28)
        }
        AlertDialog.Builder(this)
            .setTitle(if (mode == MODE_CHECKLIST) "今日小票" else "新便利贴")
            .setView(input)
            .setNegativeButton("取消") { _, _ -> finish() }
            .setPositiveButton("添加") { _, _ -> submit(mode, input.text.toString().trim()) }
            .setOnCancelListener { finish() }
            .show()
    }

    private fun submit(mode: String, text: String) {
        if (text.isEmpty()) { finish(); return }
        CoroutineScope(Dispatchers.IO).launch {
            val message = try {
                if (mode == MODE_CHECKLIST) {
                    WidgetApi.request(this@WidgetComposeActivity, "/checklist", "POST", JSONObject()
                        .put("text", text).put("added_by", "阿颖"))
                } else {
                    WidgetApi.request(this@WidgetComposeActivity, "/board", "POST", JSONObject()
                        .put("text", text).put("author", "阿颖").put("source", "yanji-widget"))
                }
                WidgetRefresh.all(this@WidgetComposeActivity)
                if (mode == MODE_CHECKLIST) "已经印到今日小票上" else "便利贴贴好啦"
            } catch (_: Exception) { "没写进去，检查一下网络和代理" }
            withContext(Dispatchers.Main) {
                Toast.makeText(this@WidgetComposeActivity, message, Toast.LENGTH_LONG).show()
                finish()
            }
        }
    }

    companion object {
        const val EXTRA_MODE = "mode"
        const val MODE_CHECKLIST = "checklist"
        const val MODE_BOARD = "board"
    }
}
