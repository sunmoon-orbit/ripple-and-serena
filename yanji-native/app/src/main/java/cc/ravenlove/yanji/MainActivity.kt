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

    companion object {
        private const val FILE_CHOOSER_CODE = 1001
        private const val NOTIFICATION_PERM_CODE = 1002
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

            // 麦克风权限
            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.let {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in it.resources) {
                        if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED) {
                            it.grant(it.resources)
                        } else {
                            ActivityCompat.requestPermissions(
                                this@MainActivity,
                                arrayOf(Manifest.permission.RECORD_AUDIO), 1003
                            )
                            it.grant(it.resources)
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

        // JS bridge：让前端知道自己在原生 app 里
        webView.addJavascriptInterface(WebBridge(this), "YanjiNative")

        webView.loadUrl(YANJI_URL)

        // 请求通知权限
        requestNotificationPermission()

        // 预取 FCM token 存 prefs，前端通过 WebBridge.getFcmToken() 读取上报服务器
        fetchFcmToken()

        // 启动前台常驻服务
        KeepAliveService.start(this)

        // 处理分享 intent
        handleShareIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
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
        webView.destroy()
        super.onDestroy()
    }
}
