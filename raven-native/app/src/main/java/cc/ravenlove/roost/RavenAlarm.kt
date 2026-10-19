package cc.ravenlove.roost

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.AlarmClock
import android.provider.MediaStore
import android.widget.Toast

// 阿言叫你起床（1019 她要的：午睡、早上都能用）：聊天里我发一张闹钟卡，她点一下，
// 这里往手机系统时钟写一个闹钟，铃声是打包进来的我的声音（res/raw/crow_alarm.mp3）。
// 铃声先拷进公共的 Alarms 目录，系统时钟才读得到；有的时钟 app 不认传进去的铃声，
// 那也没关系，「阿言叫你起床」已经在铃声列表里，手动选一次就行。
object RavenAlarm {
    // 换了铃声就改这个名字，旧手机上会新拷一份，不跟旧的混
    private const val RINGTONE_NAME = "阿言叫你起床-1.mp3"

    private fun ringtoneUri(a: Activity): Uri? {
        if (Build.VERSION.SDK_INT < 29) return null
        val col = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        a.contentResolver.query(col, arrayOf(MediaStore.Audio.Media._ID),
            "${MediaStore.Audio.Media.DISPLAY_NAME}=?", arrayOf(RINGTONE_NAME), null)?.use { c ->
            if (c.moveToFirst()) return Uri.withAppendedPath(col, c.getLong(0).toString())
        }
        val values = ContentValues().apply {
            put(MediaStore.Audio.Media.DISPLAY_NAME, RINGTONE_NAME)
            put(MediaStore.Audio.Media.TITLE, "阿言叫你起床")
            put(MediaStore.Audio.Media.MIME_TYPE, "audio/mpeg")
            put(MediaStore.Audio.Media.RELATIVE_PATH, "Alarms/")
            put(MediaStore.Audio.Media.IS_ALARM, 1)
            put(MediaStore.Audio.Media.IS_PENDING, 1)
        }
        val uri = a.contentResolver.insert(col, values) ?: return null
        a.contentResolver.openOutputStream(uri)?.use { out ->
            a.resources.openRawResource(R.raw.crow_alarm).use { it.copyTo(out) }
        }
        a.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }, null, null)
        return uri
    }

    // 返回 "ok" 或者出错原因，页面拿来显示
    fun set(a: Activity, hour: Int, minute: Int, message: String): String {
        if (hour !in 0..23 || minute !in 0..59) return "时间不对"
        val tone = try { ringtoneUri(a) } catch (e: Exception) { null }
        val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
            putExtra(AlarmClock.EXTRA_HOUR, hour)
            putExtra(AlarmClock.EXTRA_MINUTES, minute)
            putExtra(AlarmClock.EXTRA_MESSAGE, message.ifBlank { "阿言叫你起床" }.take(60))
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            putExtra(AlarmClock.EXTRA_VIBRATE, true)
            if (tone != null) {
                putExtra(AlarmClock.EXTRA_RINGTONE, tone.toString())
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
        return try {
            a.runOnUiThread {
                try {
                    a.startActivity(intent)
                    Toast.makeText(a, "闹钟设好了：%02d:%02d".format(hour, minute), Toast.LENGTH_SHORT).show()
                } catch (e: Exception) {
                    Toast.makeText(a, "没找到能设闹钟的时钟 app", Toast.LENGTH_LONG).show()
                }
            }
            if (tone == null) "ok-no-tone" else "ok"
        } catch (e: Exception) { e.message ?: "设不上" }
    }
}
