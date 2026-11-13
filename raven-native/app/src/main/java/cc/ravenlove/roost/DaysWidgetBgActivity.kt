package cc.ravenlove.roost

import androidx.appcompat.app.AppCompatActivity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
import android.widget.Toast
import java.io.File

// 1113 她要的：「你把组件换成自定义背景的呗，像言叽那样」。
// 点组件右上角的小图标进来：换一张图，或者换回米白底。图缩到 900px 存在 app 自己目录里，不上传。
class DaysWidgetBgActivity : AppCompatActivity() {
    companion object {
        const val FILE = "days_widget_bg.jpg"
        private const val PICK = 1
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val has = File(filesDir, FILE).exists()
        ThemedDialog(this).show(
            title = "组件背景",
            body = if (has) "换一张图，还是换回米白底？" else "挑一张图当背景吧。",
            positive = "挑图片",
            negative = if (has) "换回米白" else "算了",
            onNegative = {
                if (has) { File(filesDir, FILE).delete(); DaysWidget.refreshAll(this) }
            },
        ) { ok ->
            if (ok) startActivityForResult(Intent(Intent.ACTION_GET_CONTENT).setType("image/*"), PICK)
            else finish()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (requestCode == PICK && resultCode == RESULT_OK && uri != null) {
            try {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
                var sample = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 900) sample *= 2
                val bmp = contentResolver.openInputStream(uri)?.use {
                    BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
                }
                if (bmp != null) {
                    File(filesDir, FILE).outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 85, it) }
                    DaysWidget.refreshAll(this)
                }
            } catch (_: Exception) {
                Toast.makeText(this, "这张没读出来，换一张试试", Toast.LENGTH_SHORT).show()
            }
        }
        finish()
    }
}
