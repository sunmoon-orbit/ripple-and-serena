package cc.ravenlove.yanji

import android.app.Activity
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputFilter
import android.view.Gravity
import android.view.WindowManager
import android.widget.EditText
import android.widget.TextView
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
        setContentView(R.layout.activity_widget_compose)
        window.setBackgroundDrawableResource(android.R.color.transparent)
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        window.attributes = window.attributes.apply {
            width = (resources.displayMetrics.widthPixels * 0.88f).toInt()
            dimAmount = 0.62f
            gravity = Gravity.CENTER
        }

        val palette = palette()
        findViewById<android.view.View>(R.id.widget_compose_card).background = rounded(palette.card, 26f)
        findViewById<TextView>(R.id.widget_compose_kicker).apply {
            text = if (mode == MODE_CHECKLIST) "DAILY RECEIPT" else "A LITTLE NOTE"
            setTextColor(palette.accent)
        }
        findViewById<TextView>(R.id.widget_compose_title).apply {
            text = if (mode == MODE_CHECKLIST) "添一件今日要做的事" else "贴一张新的便利贴"
            setTextColor(palette.text)
        }
        findViewById<TextView>(R.id.widget_compose_hint).apply {
            text = if (mode == MODE_CHECKLIST) "写下来，就不用一直放在脑袋里。" else "想说又不着急说的话，留在这里等对方路过。"
            setTextColor(palette.muted)
        }
        val input = findViewById<EditText>(R.id.widget_compose_input).apply {
            hint = if (mode == MODE_CHECKLIST) "例如：给小猫添粮……" else "写给他，或者写给未来的自己……"
            setHintTextColor(palette.faint)
            setTextColor(palette.text)
            background = rounded(palette.input, 17f, palette.stroke)
            filters = arrayOf(InputFilter.LengthFilter(if (mode == MODE_CHECKLIST) 200 else 2000))
        }
        findViewById<TextView>(R.id.widget_compose_cancel).apply {
            setTextColor(palette.muted)
            background = rounded(Color.TRANSPARENT, 15f, palette.stroke)
            setOnClickListener { finish() }
        }
        findViewById<TextView>(R.id.widget_compose_submit).apply {
            text = if (mode == MODE_CHECKLIST) "印到小票" else "贴上去"
            setTextColor(Color.WHITE)
            background = rounded(palette.accent, 15f)
            setOnClickListener {
                val value = input.text.toString().trim()
                if (value.isEmpty()) {
                    input.error = "先写一点什么吧"
                } else {
                    isEnabled = false
                    text = if (mode == MODE_CHECKLIST) "印着……" else "贴着……"
                    submit(mode, value)
                }
            }
        }
        input.requestFocus()
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
    }

    private data class Palette(val card: Int, val input: Int, val text: Int, val muted: Int, val faint: Int, val accent: Int, val stroke: Int)

    private fun palette(): Palette {
        val theme = getSharedPreferences("yanji_theme", MODE_PRIVATE).getString("theme", "default")
        return when (theme) {
            "qingwu" -> Palette(0xFFF1F6F0.toInt(), 0xFFDDEBDD.toInt(), 0xFF293B2E.toInt(), 0xFF607565.toInt(), 0xFF8CA191.toInt(), 0xFF6B9070.toInt(), 0x406B9070)
            "xilan" -> Palette(0xFFF8EEEE.toInt(), 0xFFF0DDDE.toInt(), 0xFF493536.toInt(), 0xFF826566.toInt(), 0xFFA98C8E.toInt(), 0xFFB0787B.toInt(), 0x40B0787B)
            "glass" -> Palette(0xFFEDF5F7.toInt(), 0xFFDCECEF.toInt(), 0xFF243B43.toInt(), 0xFF5E7880.toInt(), 0xFF86A0A7.toInt(), 0xFF5A8FA0.toInt(), 0x405A8FA0)
            "chensi", "guanduan" -> Palette(0xFF34343A.toInt(), 0xFF44444B.toInt(), 0xFFF3F1F5.toInt(), 0xFFBEB9C5.toInt(), 0xFF8D8993.toInt(), 0xFF81748F.toInt(), 0x508D8993)
            "claude" -> Palette(0xFFF8F0EB.toInt(), 0xFFF0DED4.toInt(), 0xFF493229.toInt(), 0xFF85675A.toInt(), 0xFFAE8E80.toInt(), 0xFFB56F50.toInt(), 0x40B56F50)
            else -> Palette(0xFFF5F1FA.toInt(), 0xFFEAE2F3.toInt(), 0xFF342C41.toInt(), 0xFF746880.toInt(), 0xFF9B8DA8.toInt(), 0xFF8878B0.toInt(), 0x408878B0)
        }
    }

    private fun rounded(fill: Int, radiusDp: Float, stroke: Int? = null): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = radiusDp * resources.displayMetrics.density
        setColor(fill)
        if (stroke != null) setStroke((resources.displayMetrics.density).toInt().coerceAtLeast(1), stroke)
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
