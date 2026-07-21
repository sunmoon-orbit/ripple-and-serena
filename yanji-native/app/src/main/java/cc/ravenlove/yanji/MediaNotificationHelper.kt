package cc.ravenlove.yanji

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

class MediaNotificationHelper(private val context: Context) {

    companion object {
        private const val CHANNEL_ID = "yanji_media"
        private const val NOTIFICATION_ID = 2
        const val ACTION_PLAY = "cc.ravenlove.yanji.MEDIA_PLAY"
        const val ACTION_PAUSE = "cc.ravenlove.yanji.MEDIA_PAUSE"
        const val ACTION_STOP = "cc.ravenlove.yanji.MEDIA_STOP"
        const val ACTION_NEXT = "cc.ravenlove.yanji.MEDIA_NEXT"
        const val ACTION_PREV = "cc.ravenlove.yanji.MEDIA_PREV"
    }

    private val nm = context.getSystemService(NotificationManager::class.java)
    private val session = MediaSessionCompat(context, "YanjiMusic").apply {
        setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS)
        isActive = true
    }
    private var coverBitmap: Bitmap? = null
    private var lastCoverUrl: String? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // JS bridge 调这个
    var onAction: ((String) -> Unit)? = null

    init {
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
        val state = if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_STOP or PlaybackStateCompat.ACTION_SEEK_TO or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                )
                .setState(state, posMs, 1f)
                .build()
        )
        session.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "言叽")
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
                .apply { coverBitmap?.let { putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) } }
                .build()
        )
        showNotification(title, artist, playing)

        if (coverUrl.isNotEmpty() && coverUrl != lastCoverUrl) {
            lastCoverUrl = coverUrl
            scope.launch {
                try {
                    val bm = BitmapFactory.decodeStream(URL(coverUrl).openStream())
                    coverBitmap = bm
                    withContext(Dispatchers.Main) { showNotification(title, artist, playing) }
                } catch (_: Exception) {}
            }
        }
    }

    fun clear() {
        nm.cancel(NOTIFICATION_ID)
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setState(PlaybackStateCompat.STATE_NONE, 0, 0f)
                .build()
        )
    }

    fun release() {
        clear()
        session.release()
        scope.cancel()
    }

    private fun createChannel() {
        val ch = NotificationChannel(CHANNEL_ID, "正在播放", NotificationManager.IMPORTANCE_LOW).apply {
            description = "歌曲播放时显示歌名和控制按钮"
            setShowBadge(false)
        }
        nm.createNotificationChannel(ch)
    }

    private fun showNotification(title: String, artist: String, playing: Boolean) {
        val contentIntent = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val playPauseAction = if (playing) {
            NotificationCompat.Action(
                android.R.drawable.ic_media_pause, "暂停",
                mediaPendingIntent(ACTION_PAUSE)
            )
        } else {
            NotificationCompat.Action(
                android.R.drawable.ic_media_play, "播放",
                mediaPendingIntent(ACTION_PLAY)
            )
        }
        val prevAction = NotificationCompat.Action(
            android.R.drawable.ic_media_previous, "上一首",
            mediaPendingIntent(ACTION_PREV)
        )
        val nextAction = NotificationCompat.Action(
            android.R.drawable.ic_media_next, "下一首",
            mediaPendingIntent(ACTION_NEXT)
        )
        val stopAction = NotificationCompat.Action(
            android.R.drawable.ic_delete, "停止",
            mediaPendingIntent(ACTION_STOP)
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(contentIntent)
            .setLargeIcon(coverBitmap)
            .addAction(prevAction)
            .addAction(playPauseAction)
            .addAction(nextAction)
            .addAction(stopAction)
            .setStyle(MediaStyle()
                .setMediaSession(session.sessionToken)
                .setShowActionsInCompactView(0, 1, 2))
            .setOngoing(playing)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
        nm.notify(NOTIFICATION_ID, notification)
    }

    private fun mediaPendingIntent(action: String): PendingIntent {
        val intent = Intent(context, MediaActionReceiver::class.java).apply { this.action = action }
        return PendingIntent.getBroadcast(context, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}
