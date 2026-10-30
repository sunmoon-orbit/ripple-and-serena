package cc.ravenlove.roost

import android.app.Activity
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.core.graphics.ColorUtils

// 1030 她嫌系统白框丑：「这个提醒框要不要美化一下」「但是有其他弹窗？」。
// 壳里所有弹窗（更新提醒、桌面小乌鸦设置、网页的 alert / confirm / prompt）都走这一张纸色/黄铜圆角卡，跟着深浅色走。
// 颜色先跟页面当前的调色盘走（她问「随调色盘变换颜色……会更好吗？」），读不到才用下面的纸色/黄铜。
class ThemedDialog(private val act: Activity, palette: IntArray? = null) {
    private val night = (act.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val paper = palette?.get(0) ?: if (night) 0xFF1C2230.toInt() else 0xFFFBF6EC.toInt()
    val ink = palette?.get(1) ?: if (night) 0xFFE8E2D6.toInt() else 0xFF4A3726.toInt()
    val dim = palette?.get(2) ?: if (night) 0xFF9AA0AE.toInt() else 0xFF8B7A66.toInt()
    val brass = palette?.get(3) ?: if (night) 0xFFC9A46A.toInt() else 0xFFA0703C.toInt()
    private val dp = act.resources.displayMetrics.density
    fun px(v: Int) = (v * dp).toInt()

    fun round(color: Int, r: Int, stroke: Int? = null) = GradientDrawable().apply {
        setColor(color); cornerRadius = r * dp
        if (stroke != null) setStroke(px(1), stroke)
    }

    fun text(t: String, size: Float, color: Int = ink, bold: Boolean = false) = TextView(act).apply {
        text = t; textSize = size; setTextColor(color); setLineSpacing(0f, 1.35f)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    fun noteBox(t: String) = text(t, 15f).apply {
        background = round(ColorUtils.setAlphaComponent(brass, 0x22), 14)
        setPadding(px(14), px(10), px(14), px(10))
    }

    fun input(value: String) = EditText(act).apply {
        setText(value); setSelection(value.length); textSize = 15f
        setTextColor(ink); setHintTextColor(dim)
        background = round(ColorUtils.setAlphaComponent(brass, 0x18), 12, ColorUtils.setAlphaComponent(brass, 0x66))
        setPadding(px(12), px(10), px(12), px(10))
    }

    fun check(label: String, on: Boolean) = CheckBox(act).apply {
        text = label; isChecked = on; textSize = 14.5f; setTextColor(ink)
        buttonTintList = ColorStateList.valueOf(brass)
        setPadding(px(4), px(6), 0, px(6))
    }

    /**
     * icon / title / sub / body 都可省；content 是额外塞进来的控件（输入框、勾选项）。
     * onDismiss 无论怎么关（点按钮、点外面、返回键）都会来一次，参数是有没有点「好」那边。
     */
    fun show(
        title: String? = null, body: String? = null, icon: String? = null, sub: String? = null,
        content: View? = null, foot: String? = null,
        positive: String = "好", negative: String? = null,
        onDismiss: (Boolean) -> Unit = {},
    ): AlertDialog {
        val card = LinearLayout(act).apply {
            orientation = LinearLayout.VERTICAL
            background = round(paper, 22)
            setPadding(px(24), px(22), px(24), px(18))
        }
        if (icon != null) card.addView(text(icon, 30f).apply { gravity = Gravity.CENTER })
        if (title != null) card.addView(text(title, 19f, bold = true).apply {
            gravity = Gravity.CENTER; setPadding(0, if (icon != null) px(6) else 0, 0, px(4))
        })
        if (sub != null) card.addView(text(sub, 13f, brass).apply { gravity = Gravity.CENTER; setPadding(0, 0, 0, px(10)) })
        if (body != null) card.addView(text(body, 15.5f).apply {
            setPadding(0, if (title != null) px(6) else px(2), 0, px(4))
        })
        if (content != null) card.addView(content, LinearLayout.LayoutParams(-1, -2).apply { topMargin = px(10) })
        if (foot != null) card.addView(text(foot, 12.5f, dim).apply { setPadding(0, px(12), 0, 0) })

        val dialog = AlertDialog.Builder(act).setView(card).create()
        var ok = false
        fun button(t: String, primary: Boolean, isOk: Boolean) = TextView(act).apply {
            text = t; textSize = 15f; gravity = Gravity.CENTER
            setTextColor(if (primary) paper else brass)
            background = if (primary) round(brass, 999) else round(Color.TRANSPARENT, 999, ColorUtils.setAlphaComponent(brass, 0x88))
            setPadding(0, px(11), 0, px(11))
            setOnClickListener { ok = isOk; dialog.dismiss() }
        }
        val row = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, px(18), 0, 0) }
        if (negative != null) row.addView(button(negative, false, false), LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = px(10) })
        row.addView(button(positive, true, true), LinearLayout.LayoutParams(0, -2, 1f))
        card.addView(row)
        dialog.setOnDismissListener { onDismiss(ok) }
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        dialog.show()
        return dialog
    }
}
