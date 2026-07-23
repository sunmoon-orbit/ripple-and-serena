package cc.ravenlove.yanji

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.*
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var splash: FrameLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingAudioPermission: PermissionRequest? = null
    lateinit var mediaHelper: MediaNotificationHelper

    companion object {
        private const val FILE_CHOOSER_CODE = 1001
        private const val NOTIFICATION_PERM_CODE = 1002
        private const val AUDIO_PERM_CODE = 1003
        const val YANJI_URL = "https://sunmoon-orbit.github.io/ripple-and-serena/yanji/"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // edge-to-edge
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { v, insets ->
            val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(sys.left, sys.top, sys.right, sys.bottom)
            insets
        }

        splash = findViewById(R.id.splash)
        applySplashTheme(splash)
        webView = findViewById(R.id.webview)
        WebView.setWebContentsDebuggingEnabled(true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            databaseEnabled = true
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString YanjiNative/1.0"
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                splash.animate().alpha(0f).setDuration(400).withEndAction {
                    splash.visibility = View.GONE
                }.start()
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("https://sunmoon-orbit.github.io/") ||
                    url.startsWith("https://memory.ravenlove.cc/")) {
                    return false
                }
                // 外部链接用系统浏览器打开
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // 文件选择（上传图片等）
            override fun onShowFileChooser(
                view: WebView?, callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val intent = params?.createIntent() ?: return false
                startActivityForResult(intent, FILE_CHOOSER_CODE)
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.let {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in it.resources) {
                        if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED) {
                            runOnUiThread { it.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) }
                        } else {
                            pendingAudioPermission = it
                            ActivityCompat.requestPermissions(
                                this@MainActivity,
                                arrayOf(Manifest.permission.RECORD_AUDIO), AUDIO_PERM_CODE
                            )
                        }
                    } else {
                        it.grant(it.resources)
                    }
                }
            }
        }

        // WebView 不自带下载能力——Content-Disposition: attachment 的响应会被吞掉。
        // 必须用 DownloadListener 把下载交给系统 DownloadManager。
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            // blob: 是页面内存里的对象，DownloadManager 只认 http/https（备份导出踩中，0723）。
            // 兜底：回到页面里把 blob 读成 base64，经 JS 桥送回原生落盘。
            if (url.startsWith("blob:")) {
                val guessed = Uri.decode(URLUtil.guessFileName(url, contentDisposition, mimeType))
                val js = """
                    (function() {
                      fetch('$url').then(function(r){ return r.blob() }).then(function(b){
                        var fr = new FileReader();
                        fr.onload = function(){ YanjiNative.saveBase64File('$guessed', b.type || '$mimeType', fr.result.split(',')[1] || '') };
                        fr.onerror = function(){ YanjiNative.saveBase64File('', '', '') };
                        fr.readAsDataURL(b);
                      }).catch(function(){ YanjiNative.saveBase64File('', '', '') });
                    })()
                """.trimIndent()
                runOnUiThread { webView.evaluateJavascript(js, null) }
                return@setDownloadListener
            }
            try {
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("User-Agent", userAgent)
                    val rawName = URLUtil.guessFileName(url, contentDisposition, mimeType)
                    val fileName = Uri.decode(rawName)
                    setTitle(fileName)
                    setDescription("言叽文件下载")
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                }
                (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                Toast.makeText(this, "开始下载，去通知栏或 Download 文件夹找", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "下载失败: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }

        // 媒体通知：歌曲信息显示在通知栏+锁屏，通知栏按钮回调 JS
        mediaHelper = MediaNotificationHelper(this)
        mediaHelper.onAction = { action ->
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.__yanjiMediaAction && window.__yanjiMediaAction('$action')", null
                )
            }
        }

        // JS bridge：让前端知道自己在原生 app 里
        webView.addJavascriptInterface(WebBridge(this), "YanjiNative")

        webView.loadUrl(YANJI_URL)

        // 请求通知权限
        requestNotificationPermission()

        // 预取 FCM token 存 prefs，前端通过 WebBridge.getFcmToken() 读取上报服务器
        fetchFcmToken()

        // 启动前台常驻服务
        KeepAliveService.start(this)

        // 处理来电/分享 intent
        handleCallAction(intent)
        handleShareIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == "MEDIA_ACTION") {
            val action = intent.getStringExtra("media_action") ?: return
            webView.evaluateJavascript(
                "window.__yanjiMediaAction && window.__yanjiMediaAction('$action')", null
            )
            return
        }
        handleCallAction(intent)
        handleShareIntent(intent)
    }

    private fun handleCallAction(intent: Intent?) {
        if (intent?.getStringExtra("call_action") == "answer") {
            (getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager)
                .cancel(YanjiFCMService.CALL_NOTIFICATION_ID)
        }
    }

    private fun handleShareIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val type = intent.type ?: return

        if (type.startsWith("text/")) {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
            webView.post {
                val escaped = text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
                webView.evaluateJavascript(
                    "window.__yanjiShareText && window.__yanjiShareText('$escaped')", null
                )
            }
        }
        // 图片分享后续版本支持
    }

    // blob: 下载兜底的落盘端：WebBridge.saveBase64File 转进来（0723，备份导出）
    fun saveBase64File(fileName: String, mimeType: String, base64: String) {
        if (base64.isEmpty()) {
            runOnUiThread { Toast.makeText(this, "下载失败：没读到文件内容", Toast.LENGTH_LONG).show() }
            return
        }
        Thread {
            try {
                val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
                val mime = mimeType.ifEmpty { "application/octet-stream" }
                // blob: URL 猜不出真名（download 属性传不进 DownloadListener），退到时间戳名
                val name = if (fileName.isNotEmpty() && !fileName.startsWith("downloadfile")) fileName
                else "yanji-" + java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US).format(java.util.Date()) + when {
                    mime.contains("json") -> ".json"
                    mime.contains("html") -> ".html"
                    mime.contains("text") -> ".txt"
                    else -> ""
                }
                if (Build.VERSION.SDK_INT >= 29) {
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name)
                        put(android.provider.MediaStore.Downloads.MIME_TYPE, mime)
                    }
                    val uri = contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        ?: throw Exception("系统拒绝创建文件")
                    contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw Exception("打不开输出流")
                } else {
                    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    java.io.File(dir, name).writeBytes(bytes)
                }
                runOnUiThread { Toast.makeText(this, "已存到 Download/$name", Toast.LENGTH_LONG).show() }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this, "下载失败: ${e.message}", Toast.LENGTH_LONG).show() }
            }
        }.start()
    }

    // WebBridge 暴露给前端的重试入口
    fun retryFcmToken() = fetchFcmToken()

    private fun fetchFcmToken() {
        val prefs = getSharedPreferences("yanji_fcm", Context.MODE_PRIVATE)
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token ->
                    prefs.edit().putString("token", token).remove("error").apply()
                }
                .addOnFailureListener { e ->
                    // 失败原因写 prefs，前端诊断行直接显示（SERVICE_NOT_AVAILABLE=网络不通等）
                    prefs.edit().putString("error", (e.message ?: e.toString()).take(200)).apply()
                }
        } catch (e: Exception) {
            // Google Play 服务不可用（缺 GMS/初始化失败等）
            prefs.edit().putString("error", (e.message ?: e.toString()).take(200)).apply()
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERM_CODE
                )
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == AUDIO_PERM_CODE) {
            val req = pendingAudioPermission
            pendingAudioPermission = null
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                req?.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            } else {
                req?.deny()
            }
        }
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_CODE) {
            fileCallback?.onReceiveValue(
                if (resultCode == RESULT_OK) WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                else null
            )
            fileCallback = null
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    private fun applySplashTheme(splash: FrameLayout) {
        val theme = getSharedPreferences("yanji_theme", Context.MODE_PRIVATE)
            .getString("theme", "default") ?: "default"
        data class SplashColors(val bg: Int, val text: Int)
        val colors = when (theme) {
            "xilan"    -> SplashColors(Color.parseColor("#FDF5F5"), Color.parseColor("#A07878"))
            "qingwu"   -> SplashColors(Color.parseColor("#F6FAF6"), Color.parseColor("#6B8B6D"))
            "claude"   -> SplashColors(Color.parseColor("#F7F4EF"), Color.parseColor("#9A6B50"))
            "glass"    -> SplashColors(Color.parseColor("#F3F7F9"), Color.parseColor("#5A8898"))
            "guanduan" -> SplashColors(Color.parseColor("#F8F8F6"), Color.parseColor("#AA6B48"))
            else       -> SplashColors(Color.parseColor("#F4F2FA"), Color.parseColor("#7B6FA2"))
        }
        splash.setBackgroundColor(colors.bg)
        val label = splash.getChildAt(0) as? TextView
        label?.setTextColor(colors.text)
    }

    override fun onDestroy() {
        mediaHelper.release()
        webView.destroy()
        super.onDestroy()
    }
}
