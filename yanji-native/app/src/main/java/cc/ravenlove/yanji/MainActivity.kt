package cc.ravenlove.yanji

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.*
import android.widget.FrameLayout
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

        // JS bridge：让前端知道自己在原生 app 里
        webView.addJavascriptInterface(WebBridge(this), "YanjiNative")

        webView.loadUrl(YANJI_URL)

        // 请求通知权限
        requestNotificationPermission()

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

    @Deprecated("Use Activity Result API")
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

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
