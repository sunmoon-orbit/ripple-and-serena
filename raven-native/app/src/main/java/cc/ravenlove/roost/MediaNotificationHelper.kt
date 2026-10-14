package cc.ravenlove.roost

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import kotlinx.coroutines.*
import java.net.URL

// 通知栏播放器（1014，从言叽搬来）：页面里放歌时把歌名、封面、播放状态报进来，
// 通知栏和锁屏显示上一首／暂停／下一首／停止，按下去回调页面里的 window.__roostMediaAction。
// 和言叽不同的地方：按钮不再借 Activity 中转（安卓 12 起拦「通知跳板」），
// 广播直接找到活着的这个 helper 调回调。
class MediaNotificationHelper(private val context: Context) {

    companion object {
        private const val CHANNEL_ID = "roost_media"
        private const val NOTIFICATION_ID = 7
        const val ACTION_PLAY = "cc.ravenlove.roost.MEDIA_PLAY"
        const val ACTION_PAUSE = "cc.ravenlove.roost.MEDIA_PAUSE"
        const val ACTION_STOP = "cc.ravenlove.roost.MEDIA_STOP"
        const val ACTION_NEXT = "cc.ravenlove.roost.MEDIA_NEXT"
        const val ACTION_PREV = "cc.ravenlove.roost.MEDIA_PREV"

        @Volatile var instance: MediaNotificationHelper? = null
    }

    private val nm = context.getSystemService(NotificationManager::class.java)
    private val session = MediaSessionCompat(context, "RoostMusic").apply { isActive = true }
    private var coverBitmap: Bitmap? = null
    private var lastCoverUrl: String? = null
    private var lastTitle = ""
    private var lastArtist = ""
    private var lastPlaying = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    var onAction: ((String) -> Unit)? = null

    init {
        instance = this
        createChannel()
        session.setCallback(object : MediaSessionCompat.Callback() {
            override fun onPlay() { onAction?.invoke("play") }
            override fun onPause() { onAction?.invoke("pause") }
            override fun onStop() { onAction?.invoke("stop") }
            override fun onSkipToNext() { onAction?.invoke("next") }
            override fun onSkipToPrevious() { onAction?.invoke("prev") }
            override fun onSeekTo(pos: Long) { onAction?.invoke("seek:$pos") }
        })
    }

    fun update(title: String, artist: String, coverUrl: String, playing: Boolean, posMs: Long, durationMs: Long) {
        lastTitle = title; lastArtist = artist; lastPlaying = playing
        val state = if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_STOP or
                    PlaybackStateCompat.ACTION_SEEK_TO or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                )
                .setState(state, posMs, if (playing) 1f else 0f)
                .build()
        )
        setMetadata(durationMs)
        showNotification()

        if (coverUrl.isNotEmpty() && coverUrl != lastCoverUrl) {
            lastCoverUrl = coverUrl
            scope.launch {
                try {
                    val bm = URL(coverUrl).openStream().use { BitmapFactory.decodeStream(it) }
                    withContext(Dispatchers.Main) {
                        coverBitmap = bm
                        setMetadata(durationMs)
                        showNotification()
                    }
                } catch (_: Exception) {}
            }
        } else if (coverUrl.isEmpty()) {
            lastCoverUrl = null; coverBitmap = null
        }
    }

    fun dispatch(action: String) { onAction?.invoke(action) }

    fun clear() {
        nm.cancel(NOTIFICATION_ID)
        session.setPlaybackState(PlaybackStateCompat.Builder().setState(PlaybackStateCompat.STATE_NONE, 0, 0f).build())
    }

    fun release() {
        clear()
        session.release()
        scope.cancel()
        if (instance === this) instance = null
    }

    private fun setMetadata(durationMs: Long) {
        session.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, lastTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, lastArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "归巢")
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
                .apply { coverBitmap?.let { putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) } }
                .build()
        )
    }

    private fun createChannel() {
        val ch = NotificationChannel(CHANNEL_ID, "正在播放", NotificationManager.IMPORTANCE_LOW).apply {
            description = "听歌时显示歌名和控制按钮"
            setShowBadge(false)
        }
        nm.createNotificationChannel(ch)
    }

    private fun showNotification() {
        val contentIntent = PendingIntent.getActivity(
            context, 7001,
            Intent(context, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val playPause = if (lastPlaying)
            NotificationCompat.Action(android.R.drawable.ic_media_pause, "暂停", pending(ACTION_PAUSE))
        else
            NotificationCompat.Action(android.R.drawable.ic_media_play, "播放", pending(ACTION_PLAY))
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(lastTitle)
            .setContentText(lastArtist)
            .setContentIntent(contentIntent)
            .setLargeIcon(coverBitmap)
            .addAction(NotificationCompat.Action(android.R.drawable.ic_media_previous, "上一首", pending(ACTION_PREV)))
            .addAction(playPause)
            .addAction(NotificationCompat.Action(android.R.drawable.ic_media_next, "下一首", pending(ACTION_NEXT)))
            .addAction(NotificationCompat.Action(android.R.drawable.ic_menu_close_clear_cancel, "停止", pending(ACTION_STOP)))
            .setStyle(MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
            .setOngoing(lastPlaying)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
        nm.notify(NOTIFICATION_ID, notification)
    }

    private fun pending(action: String): PendingIntent {
        val intent = Intent(context, MediaActionReceiver::class.java).apply { this.action = action }
        return PendingIntent.getBroadcast(context, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}
