package cc.ravenlove.yanji

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin

/** 按网页版同一组音符实时合成 PCM；一整个 repeatMs 周期由 AudioTrack 无缝循环。 */
class NativeRingtonePlayer {
    data class Note(
        val frequency: Double,
        val at: Double,
        val duration: Double,
        val volume: Double,
        val type: Wave = Wave.SINE,
        val attack: Double = 0.04
    )
    enum class Wave { SINE, TRIANGLE, SQUARE }
    data class Ringtone(val repeatMs: Int, val vibrate: LongArray, val notes: List<Note>)

    private var track: AudioTrack? = null

    fun start(id: String): Ringtone {
        stop()
        val ringtone = RINGTONES[id] ?: RINGTONES.getValue("soft-chime")
        val sampleRate = 44_100
        val frameCount = (sampleRate * ringtone.repeatMs / 1000.0).roundToInt()
        val mixed = DoubleArray(frameCount)
        ringtone.notes.forEach { note ->
            val first = (note.at * sampleRate).roundToInt().coerceAtLeast(0)
            val count = (note.duration * sampleRate).roundToInt()
            for (offset in 0 until count) {
                val index = first + offset
                if (index >= mixed.size) break
                val elapsed = offset.toDouble() / sampleRate
                val phase = 2.0 * PI * note.frequency * elapsed
                val wave = when (note.type) {
                    Wave.SINE -> sin(phase)
                    Wave.TRIANGLE -> 2.0 / PI * asin(sin(phase))
                    Wave.SQUARE -> if (sin(phase) >= 0.0) 1.0 else -1.0
                }
                val gain = if (elapsed < note.attack) {
                    note.volume * elapsed / max(note.attack, 0.0001)
                } else {
                    // 对应 WebAudio 从峰值指数衰减到 0.0001。
                    val tail = max(note.duration - note.attack, 0.0001)
                    note.volume * exp(kotlin.math.ln(0.0001 / note.volume) * (elapsed - note.attack) / tail)
                }
                mixed[index] += wave * gain
            }
        }
        // 网页版这几个 volume（0.035~0.1）是给「贴着耳朵的浏览器」定的，直接搬到闹钟流上
        // 峰值只有满量程的十分之一——等于"穿透了静音，却还是听不见"，白修。
        // 这里按峰值归一到 0.85，把音量大小交回给系统的闹钟音量条；
        // 倍数封顶 12 倍，免得某个几乎全是静默的波形被放大成底噪。
        val peak = mixed.maxOfOrNull { kotlin.math.abs(it) } ?: 0.0
        val boost = if (peak > 0.0001) (0.85 / peak).coerceAtMost(12.0) else 1.0
        val pcm = ShortArray(frameCount) { i ->
            ((mixed[i] * boost).coerceIn(-1.0, 1.0) * Short.MAX_VALUE).roundToInt().toShort()
        }
        val local = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build())
            .setAudioFormat(AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRate)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build())
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(pcm.size * 2)
            .build()
        try {
            val written = local.write(pcm, 0, pcm.size)
            check(written == pcm.size) { "PCM 写入不完整：$written/${pcm.size}" }
            check(local.setLoopPoints(0, pcm.size, -1) == AudioTrack.SUCCESS) { "无法设置铃声循环" }
            local.play()
            track = local
            return ringtone
        } catch (e: Exception) {
            try { local.release() } catch (_: Exception) { }
            throw e
        }
    }

    fun stop() {
        val local = track
        track = null
        try { local?.stop() } catch (_: Exception) { }
        try { local?.release() } catch (_: Exception) { }
    }

    companion object {
        private fun n(f: Double, at: Double, d: Double, v: Double, type: Wave = Wave.SINE, attack: Double = 0.04) =
            Note(f, at, d, v, type, attack)

        val RINGTONES = mapOf(
            "soft-chime" to Ringtone(2800, longArrayOf(280, 180, 280), listOf(
                n(659.25, 0.0, 0.9, 0.1), n(523.25, 0.22, 0.9, 0.1))),
            "moon-window" to Ringtone(3600, longArrayOf(150, 100, 150, 100, 220), listOf(
                n(523.25, 0.0, 1.25, 0.065, Wave.TRIANGLE),
                n(659.25, 0.18, 1.2, 0.06, Wave.TRIANGLE), n(783.99, 0.38, 1.35, 0.05))),
            "pillow-tide" to Ringtone(4200, longArrayOf(420, 260, 180), listOf(
                n(392.0, 0.0, 1.7, 0.05, attack = 0.18),
                n(493.88, 0.08, 1.8, 0.042, attack = 0.2),
                n(440.0, 1.05, 1.55, 0.045, attack = 0.16))),
            "wind-reply" to Ringtone(3800, longArrayOf(120, 240, 120), listOf(
                n(698.46, 0.0, 1.35, 0.05), n(880.0, 0.16, 1.25, 0.035),
                n(587.33, 0.72, 1.4, 0.055, Wave.TRIANGLE))),
            "old-letter" to Ringtone(3300, longArrayOf(200, 140, 200), listOf(
                n(440.0, 0.0, 0.42, 0.035, Wave.SQUARE, 0.035),
                n(523.25, 0.0, 0.42, 0.025, attack = 0.035),
                n(440.0, 0.58, 0.42, 0.035, Wave.SQUARE, 0.035),
                n(523.25, 0.58, 0.42, 0.025, attack = 0.035)))
        )
    }
}
