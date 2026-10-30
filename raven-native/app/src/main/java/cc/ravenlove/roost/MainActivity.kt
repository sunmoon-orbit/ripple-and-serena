package cc.ravenlove.roost

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.View
import android.webkit.*
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.ColorUtils
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    lateinit var mediaHelper: MediaNotificationHelper
    private lateinit var splash: FrameLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingAudioPermission: PermissionRequest? = null

    companion object {
        // 正在前台、而且开着聊天页（/raven/ 或 index.html）：我打来的电话由网页弹，壳不响（1022）
        @Volatile var onChatPage = false
        private const val FILE_CHOOSER_CODE = 1001
        private const val NOTIFICATION_PERM_CODE = 1002
        private const val AUDIO_PERM_CODE = 1003
        // 阿颖装的 PWA 入口就是 home.html（0702 确认），原生壳保持一致
        const val ROOST_URL = "https://memory.ravenlove.cc/raven/home.html"
    }

    // 网页铺不到状态栏那条（内容区让出了系统栏的边距），那一条露的是窗口底色。
    // 通话这种整页的界面让网页把自己的底色告诉壳，壳把内容区底色设成它，图标深浅跟着变；"" 还原成原来的样子。
    private var barLightDefault: Boolean? = null
    fun setBarColor(color: String) {
        val root = findViewById<View>(android.R.id.content)
        val ctl = WindowCompat.getInsetsController(window, window.decorView)
        if (barLightDefault == null) barLightDefault = ctl.isAppearanceLightStatusBars
        val c = try { if (color.isBlank()) null else android.graphics.Color.parseColor(color) } catch (e: Exception) { null }
        if (c == null) {
            root.background = null
            ctl.isAppearanceLightStatusBars = barLightDefault ?: false
            ctl.isAppearanceLightNavigationBars = barLightDefault ?: false
            return
        }
        root.setBackgroundColor(c)
        val light = ColorUtils.calculateLuminance(c) > 0.5
        ctl.isAppearanceLightStatusBars = light
        ctl.isAppearanceLightNavigationBars = light
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { v, insets ->
            val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(sys.left, sys.top, sys.right, sys.bottom)
            insets
        }

        splash = findViewById(R.id.splash)
        webView = findViewById(R.id.webview)
        WebView.setWebContentsDebuggingEnabled(true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // ⚠️ 聊天记录/便签/待办全在 localStorage，关掉这条等于清空
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            databaseEnabled = true
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString RoostNative/1.0"
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                pageUrl = url ?: ""
                updateChatFlag()
                splash.animate().alpha(0f).setDuration(400).withEndAction {
                    splash.visibility = View.GONE
                }.start()
            }

            // 1023 她嫌安卓自带的「Webpage not available」丑：主页面加载失败就换成壳里自己的离线页，
            // 网回来离线页自己跳回原地址（地址放在 # 后面带过去）。图片、接口这些子请求失败不管。
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame != true) return
                val failed = request.url?.toString() ?: return
                if (failed.startsWith("file:///android_asset/")) return
                // 1030：把错误原因带过去显示（ERR_PROXY_CONNECTION_FAILED / ERR_NAME_NOT_RESOLVED…），她截图就能分清是代理还是没网
                val why = "${error?.errorCode ?: ""} ${error?.description ?: ""}".trim()
                view?.loadUrl("file:///android_asset/offline.html?e=" + Uri.encode(why) + "#" + Uri.encode(failed))
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("file:///android_asset/")) return false
                if (url.startsWith("https://memory.ravenlove.cc/") ||
                    url.startsWith("https://sunmoon-orbit.github.io/")) {
                    return false
                }
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // ⚠️ 不实现这个方法，页面里的 <input type=file> 点了毫无反应——
            // 「搬家」的导入、聊天里的发图都靠它（0723 言叽同款）
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
                            pendingAudioPermission?.deny()
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

        // WebView 不自带下载能力，Content-Disposition: attachment 的响应会被直接吞掉，
        // 必须用 DownloadListener 转交系统 DownloadManager。
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            // ⚠️ blob: 是页面内存里的对象，DownloadManager 只认 http/https（0723 言叽备份导出踩中）。
            // 「搬家」导出走的正是 blob:，没有这段兜底 = 点了导出什么也不发生。
            // 兜底做法：回页面里把 blob 读成 base64，经 JS 桥送回原生落盘。
            if (url.startsWith("blob:")) {
                val guessed = Uri.decode(URLUtil.guessFileName(url, contentDisposition, mimeType))
                val js = """
                    (function() {
                      fetch('$url').then(function(r){ return r.blob() }).then(function(b){
                        var fr = new FileReader();
                        fr.onload = function(){ RoostNative.saveBase64File('$guessed', b.type || '$mimeType', fr.result.split(',')[1] || '') };
                        fr.onerror = function(){ RoostNative.saveBase64File('', '', '') };
                        fr.readAsDataURL(b);
                      }).catch(function(){ RoostNative.saveBase64File('', '', '') });
                    })()
                """.trimIndent()
                runOnUiThread { webView.evaluateJavascript(js, null) }
                return@setDownloadListener
            }
            // 外站链接和打包下载点（/raven/download/）交给浏览器（1014 她说系统下载器慢、看不到进度，1015 做）；
            // 浏览器开不了再退回系统下载器。别的站内文件照旧走系统下载器
            val u = Uri.parse(url)
            if (u.host != "memory.ravenlove.cc" || (u.path ?: "").startsWith("/raven/download/")) {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE))
                    Toast.makeText(this, "交给浏览器下载了", Toast.LENGTH_SHORT).show()
                    return@setDownloadListener
                } catch (_: Exception) {}
            }
            try {
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("User-Agent", userAgent)
                    val fileName = Uri.decode(URLUtil.guessFileName(url, contentDisposition, mimeType))
                    setTitle(fileName)
                    setDescription("归巢文件下载")
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                }
                (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                Toast.makeText(this, "开始下载，去通知栏或 Download 文件夹找", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "下载失败: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }

        // 通知栏播放器（1014）：按钮回调页面里的 window.__roostMediaAction
        mediaHelper = MediaNotificationHelper(this)
        mediaHelper.onAction = { action ->
            runOnUiThread {
                webView.evaluateJavascript("window.__roostMediaAction && window.__roostMediaAction('$action')", null)
            }
        }
        webView.addJavascriptInterface(WebBridge(this), "RoostNative")
        webView.loadUrl(ROOST_URL)

        requestNotificationPermission()
        fetchFcmToken()
        checkUpdate()
        handleShareIntent(intent)
        handleAnswerIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
        handleAnswerIntent(intent)
    }

    private var pageUrl = ""
    private var resumed = false
    private fun updateChatFlag() {
        val path = android.net.Uri.parse(pageUrl).path ?: ""
        onChatPage = resumed && (path == "/raven/" || path == "/raven" || path.endsWith("/raven/index.html"))
    }
    override fun onResume() { super.onResume(); resumed = true; updateChatFlag(); CallRingService.stop(this) }
    override fun onPause() { super.onPause(); resumed = false; updateChatFlag() }

    // 来电页点了接听：开着聊天页就直接接，不然带着 ?answer= 打开聊天页
    private fun handleAnswerIntent(intent: Intent?) {
        val id = intent?.getStringExtra("answerCall") ?: return
        intent?.removeExtra("answerCall")
        if (!id.matches(Regex("[a-z0-9]{1,24}"))) return
        webView.post {
            val path = android.net.Uri.parse(webView.url ?: "").path ?: ""
            if (path == "/raven/" || path == "/raven" || path.endsWith("/raven/index.html"))
                webView.evaluateJavascript("window.rvAnswerCall && rvAnswerCall('$id')", null)
            else webView.loadUrl("https://memory.ravenlove.cc/raven/?answer=$id")
        }
    }

    private fun handleShareIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val type = intent.type ?: return
        if (type.startsWith("text/")) {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
            webView.post {
                val escaped = text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
                webView.evaluateJavascript("window.__roostShareText && window.__roostShareText('$escaped')", null)
            }
        }
    }

    // blob: 下载兜底的落盘端：WebBridge.saveBase64File 转进来
    fun saveBase64File(fileName: String, mimeType: String, base64: String) {
        if (base64.isEmpty()) {
            runOnUiThread { Toast.makeText(this, "导出失败：没读到文件内容", Toast.LENGTH_LONG).show() }
            return
        }
        Thread {
            try {
                val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
                val mime = mimeType.ifEmpty { "application/octet-stream" }
                // blob: URL 猜不出真名（download 属性传不进 DownloadListener），退到时间戳名
                val name = if (fileName.isNotEmpty() && !fileName.startsWith("downloadfile")) fileName
                else "归巢搬家-" + java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US).format(java.util.Date()) + ".json"
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
                runOnUiThread { Toast.makeText(this, "导出失败: ${e.message}", Toast.LENGTH_LONG).show() }
            }
        }.start()
    }

    fun retryFcmToken() = fetchFcmToken()

    private fun fetchFcmToken() {
        val prefs = getSharedPreferences("roost_fcm", Context.MODE_PRIVATE)
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token -> prefs.edit().putString("token", token).remove("error").apply() }
                .addOnFailureListener { e ->
                    // 失败原因写 prefs，前端诊断行直接显示（SERVICE_NOT_AVAILABLE = 网络不通等）
                    prefs.edit().putString("error", (e.message ?: e.toString()).take(200)).apply()
                }
        } catch (e: Exception) {
            // Google Play 服务不可用（缺 GMS / 初始化失败等）
            prefs.edit().putString("error", (e.message ?: e.toString()).take(200)).apply()
        }
    }

    // 版本检查：服务端去问 GitHub Release 的构建号，本地拿 versionCode 比大小。
    // 有新版就弹一次，不强制；「以后再说」当次不再打扰。
    private fun checkUpdate() {
        Thread {
            try {
                val conn = java.net.URL("https://memory.ravenlove.cc/raven/app-latest")
                    .openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                val latest = Regex("\"versionCode\"\\s*:\\s*(\\d+)").find(body)
                    ?.groupValues?.get(1)?.toIntOrNull() ?: return@Thread
                val url = Regex("\"url\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.get(1) ?: return@Thread
                val note = Regex("\"note\"\\s*:\\s*\"([^\"]*)\"").find(body)?.groupValues?.get(1) ?: ""
                if (latest <= BuildConfig.VERSION_CODE) return@Thread
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    AlertDialog.Builder(this)
                        .setTitle("归巢有新版本了")
                        .setMessage(
                            "当前 ${BuildConfig.VERSION_NAME}，最新 1.0.$latest。\n\n" +
                            (if (note.isNotEmpty()) "$note\n\n" else "") +
                            "下载后直接安装覆盖就行，不用卸载，聊天记录都在。"
                        )
                        .setPositiveButton("去下载") { _, _ ->
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        }
                        .setNegativeButton("以后再说", null)
                        .show()
                }
            } catch (_: Exception) {
                // 查不到就算了，版本检查不该打断使用
            }
        }.start()
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
            val request = pendingAudioPermission
            pendingAudioPermission = null
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                request?.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            } else {
                request?.deny()
                Toast.makeText(this, "需要麦克风权限才能使用归巢通话", Toast.LENGTH_LONG).show()
            }
        }
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_CODE) {
            // 多选（贴图架的 <input multiple>）时系统把图放在 ClipData 里，parseResult 只读 data.data，会拿到 null（1015 她传贴图什么都没收到）
            val clip = data?.clipData
            fileCallback?.onReceiveValue(
                if (resultCode != RESULT_OK) null
                else if (clip != null && clip.itemCount > 0) Array(clip.itemCount) { clip.getItemAt(it).uri }
                else WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            )
            fileCallback = null
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    // 回到归巢就收起桌面小乌鸦，离开了再放出来
    override fun onStart() { super.onStart(); CrowOverlay.get(this).setForeground(true) }
    override fun onStop() { super.onStop(); CrowOverlay.get(this).setForeground(false) }

    // 桌面小乌鸦的设置（1015）：两个开关；开小乌鸦时没有悬浮窗权限就先去系统设置里给
    fun openCrowSettings() {
        val crow = CrowOverlay.get(this)
        val checked = booleanArrayOf(crow.enabled, mediaHelper.chipEnabled)
        AlertDialog.Builder(this)
            .setTitle("桌面小乌鸦")
            .setMultiChoiceItems(arrayOf("离开归巢时，屏幕边上蹲一只小乌鸦（放歌时带歌词）", "状态栏歌词胶囊（试验，系统不一定肯显示）"), checked) { _, i, v -> checked[i] = v }
            .setPositiveButton("好") { _, _ ->
                crow.enabled = checked[0]
                mediaHelper.chipEnabled = checked[1]
                if (checked[0] && !crow.canDraw()) {
                    Toast.makeText(this, "要先允许「显示在其他应用上层」", Toast.LENGTH_LONG).show()
                    try { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) } catch (_: Exception) {}
                }
            }
            .setNegativeButton("算了", null)
            .show()
    }

    override fun onDestroy() {
        CrowOverlay.get(this).release()
        mediaHelper.release()
        webView.destroy()
        super.onDestroy()
    }
}
