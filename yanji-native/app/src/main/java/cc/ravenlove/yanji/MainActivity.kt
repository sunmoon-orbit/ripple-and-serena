package cc.ravenlove.yanji

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.app.NotificationManager
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.View
import android.webkit.*
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var splash: FrameLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingAudioPermission: PermissionRequest? = null
    private var waitingForDndSettings = false
    private var dndPromptShown = false
    private var pendingCallChannelProblem: String? = null
    private var channelProblemPromptScheduled = false
    lateinit var mediaHelper: MediaNotificationHelper

    // 页面还没加载完时调 evaluateJavascript 等于把话说进空气里。
    // onCreate 里就要处理的 intent（通知栏回复、系统分享）全排在这儿，
    // onPageFinished 再一起倒出去。
    private var pageReady = false
    private val pendingJs = mutableListOf<String>()

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
        IntentIdentity.migrateOnce(this)

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
                pageReady = true
                pendingJs.forEach { webView.evaluateJavascript(it, null) }
                pendingJs.clear()
            }

            // 断网兜底（0729 加）。在这之前连不上就是**一片白屏**，看不出是没网、
            // 服务器挂了、还是 app 坏了。
            // ⚠️ 只认主文档失败：isForMainFrame 不判的话，随便一张图片 404 都会
            // 把整个页面顶掉，正常用着用着就跳到「连不上」去了。
            override fun onReceivedError(
                view: WebView?, request: WebResourceRequest?, error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame != true) return
                showOffline(error?.description?.toString())
            }

            override fun onReceivedHttpError(
                view: WebView?, request: WebResourceRequest?, response: WebResourceResponse?
            ) {
                super.onReceivedHttpError(view, request, response)
                if (request?.isForMainFrame != true) return
                showOffline("HTTP ${response?.statusCode}")
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
        promptNotificationPolicyAccess()
        loadCallChannelProblem()

        // 预取 FCM token 存 prefs，前端通过 WebBridge.getFcmToken() 读取上报服务器
        fetchFcmToken()

        // 启动前台常驻服务
        KeepAliveService.start(this)

        // 处理来电/分享/通知栏回复 intent
        handleCallAction(intent)
        handleShareIntent(intent)
        handleQuickReply(intent)

        // 全屏来电权限（安卓14+）。延后 3 秒：先让她看到 app 起来，别一点图标就被踹进设置页
        webView.postDelayed({ promptFullScreenIntentPermission() }, 3000)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == "MEDIA_ACTION") {
            val action = intent.getStringExtra("media_action") ?: return
            webView.evaluateJavascript(
                "window.__yanjiMediaAction && window.__yanjiMediaAction('$action')", null
            )
            return
        }
        handleCallAction(intent)
        handleShareIntent(intent)
        handleQuickReply(intent)
    }

    override fun onResume() {
        super.onResume()
        if (waitingForDndSettings) {
            waitingForDndSettings = false
            val granted = getSystemService(NotificationManager::class.java)
                .isNotificationPolicyAccessGranted
            Toast.makeText(
                this,
                if (granted) "已允许来电穿过勿扰模式" else "还没有允许；普通状态下仍能收到来电",
                Toast.LENGTH_LONG
            ).show()
        }
        scheduleCallChannelProblemPrompt()
    }

    // 来电渠道的体检结果（0804）。YanjiFCMService 每次建完渠道会把系统读回来的真实状态
    // 存进 prefs（正常时是 null），后台服务不能弹 UI，所以由这里代为转达。
    // 延迟 6 秒＋要求窗口有焦点：3 秒那会儿可能正被全屏通知权限的设置页盖着，
    // 别让两条提示叠在一起；被盖住就不弹，等下一次 onResume 再排。
    private fun loadCallChannelProblem() {
        pendingCallChannelProblem = getSharedPreferences(
            YanjiFCMService.DIAGNOSTICS_PREFS, Context.MODE_PRIVATE
        ).getString(YanjiFCMService.CALL_CHANNEL_PROBLEM, null)
        scheduleCallChannelProblemPrompt()
    }

    private fun scheduleCallChannelProblemPrompt() {
        if (pendingCallChannelProblem == null || channelProblemPromptScheduled) return
        channelProblemPromptScheduled = true
        webView.postDelayed({
            channelProblemPromptScheduled = false
            if (!hasWindowFocus()) return@postDelayed
            val problem = pendingCallChannelProblem ?: return@postDelayed
            pendingCallChannelProblem = null
            getSharedPreferences(YanjiFCMService.DIAGNOSTICS_PREFS, Context.MODE_PRIVATE)
                .edit().remove(YanjiFCMService.CALL_CHANNEL_PROBLEM).apply()
            Toast.makeText(
                this,
                "$problem。可以去系统设置里的“通知”找到“涟言来电”调整。",
                Toast.LENGTH_LONG
            ).show()
        }, 6000)
    }

    private fun promptNotificationPolicyAccess() {
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.isNotificationPolicyAccessGranted || dndPromptShown) return
        dndPromptShown = true
        AlertDialog.Builder(this)
            .setTitle("让来电在勿扰时也能出现")
            .setMessage("如果你愿意，可以允许言叽使用“通知策略访问”。只用于让涟言来电穿过勿扰模式；不授权也不影响普通状态下使用。")
            .setNegativeButton("暂时不用", null)
            .setPositiveButton("去设置") { _, _ ->
                try {
                    waitingForDndSettings = true
                    startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
                } catch (_: Exception) {
                    waitingForDndSettings = false
                    Toast.makeText(this, "没能打开系统设置，请在设置里搜索“通知策略访问”", Toast.LENGTH_LONG).show()
                }
            }
            .show()
    }

    // JS 字符串字面量转义。只转引号是不够的：换行/反斜杠会让整段 JS 语法错误，
    // 而 evaluateJavascript 的语法错误是**静默**的（没有回调就没有报错）。
    private fun jsStr(s: String) = s
        .replace("\\", "\\\\").replace("'", "\\'")
        .replace("\n", "\\n").replace("\r", "\\r")
        // U+2028/2029 在 JS 里也算换行符，会把字符串字面量拦腰截断
        .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

    // 把一句话送进页面。页面没 ready 就排队；ready 了也可能 React 还没挂载完
    // （onPageFinished 早于组件注册回调），所以注入的 JS 自带 15 秒轮询重试。
    private fun callWeb(fn: String, text: String) {
        val js = """
            (function(){
              var t='${jsStr(text)}', n=0;
              function say(m){ try { YanjiNative.toast(m) } catch(e) {} }
              (function go(){
                if (window.$fn) { say('页面接住了（$fn）'); window.$fn(t); return; }
                if (++n > 60) { say('页面里等了15秒也没有 $fn，放弃'); return; }
                setTimeout(go, 250);
              })();
            })()
        """.trimIndent()
        runOnUiThread {
            if (pageReady) webView.evaluateJavascript(js, null) else pendingJs.add(js)
        }
    }

    // 通知栏快捷回复：把她在通知里打的字带进 app 直接发出去。
    // 服务端没有言叽的会话可写（对话在 localStorage、key 在前端），所以只能走这条路。
    private fun handleQuickReply(intent: Intent?) {
        if (intent?.getBooleanExtra("quick_reply", false) != true) return
        val text = RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence(YanjiFCMService.KEY_REPLY)?.toString()?.trim().orEmpty()
        // 通知先收掉：她已经说完了，留着那条旧消息在通知栏没意义
        val notifId = intent.getIntExtra("notif_id", -1)
        if (notifId != -1) {
            (getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager).cancel(notifId)
        }
        intent.removeExtra("quick_reply")   // 别让转屏/重建时又发一遍
        // ⚠️ 0726：这条路每一步都是静默的——取不到 RemoteInput、注入的 JS 语法错、
        // 前端函数一直没挂上，全都一声不吭，阿颖那边只看到「好像没发过来」。
        // 装上灯：每一步都吐一个 Toast，坏在哪一步要看得见。
        if (text.isEmpty()) {
            Toast.makeText(this, "言叽：没取到通知栏输入的内容", Toast.LENGTH_LONG).show()
            return
        }
        Toast.makeText(this, "言叽收到：$text", Toast.LENGTH_SHORT).show()
        callWeb("__yanjiQuickReply", text)
    }

    private fun showOffline(detail: String?) {
        val hash = if (detail.isNullOrBlank()) "" else "#" + Uri.encode(detail)
        webView.loadUrl("file:///android_asset/offline.html$hash")
    }

    // 来电：answer=她按了接听（收掉通知）；incoming=全屏 intent 把 app 拉起来了。
    // ⚠️ 光有 setFullScreenIntent 不够：Activity 默认起在锁屏**后面**，屏幕也不会亮。
    // showWhenLocked + turnScreenOn 这两下才是「屏幕黑着突然整屏亮起来」的真正来源。
    private fun handleCallAction(intent: Intent?) {
        val action = intent?.getStringExtra("call_action") ?: return
        if (action == "answer") {
            (getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager)
                .cancel(YanjiFCMService.CALL_NOTIFICATION_ID)
            // 她在原生来电页/通知上已经按过一次接听了，进来不该再让她按第二次。
            // 前端收到这一声就自动接起当前那通（拿不到就等轮询到 invite 再自动接，见前端）。
            callWeb("__yanjiAnswerCall", "native")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            // 没设密码锁的话顺手把锁屏收掉；有密码锁的系统会忽略这句，她解锁后才进来
            (getSystemService(KEYGUARD_SERVICE) as android.app.KeyguardManager)
                .requestDismissKeyguard(this, null)
        }
        intent.removeExtra("call_action")   // 别让转屏/重建时再亮一次屏
    }

    // 安卓 14 起「全屏通知」是单独一项权限，只有系统认定的通话/闹钟类 app 默认给，
    // 我们这种侧载的 app 装上就是**关的**——而且关着的时候 setFullScreenIntent 会
    // **静默降级成普通横幅**，不报错。所以必须主动check并把她送到那一页去开。
    private fun promptFullScreenIntentPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return
        val nm = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        if (nm.canUseFullScreenIntent()) return

        Toast.makeText(this, "涟言来电还不能在锁屏弹出：正在打开「全屏通知」设置页", Toast.LENGTH_LONG).show()

        // 0804：原来这里存了个 `jumped` 标记「只主动跳一次设置页，免得天天弹她一脸」。
        // 那条判断是错的，代价很大：
        //   1. 覆盖安装会保留 app data，标记还在，但系统可能已经把权限收回了
        //      —— 于是只剩一个一闪而过的 Toast，来电从此不亮屏，而且不报错。
        //   2. 这一页在国产 ROM 里不在「应用权限管理」下面（属「特殊应用权限」），
        //      她照 Toast 里的路径**找不到**，唯一进得去的方式就是这个跳转。
        // 权限关着 = 来电功能是坏的，这时候每次启动都送她过去才是对的；
        // 一旦开好，canUseFullScreenIntent() 上面就 return 了，自然再也不弹。
        try {
            startActivity(Intent(
                android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                Uri.parse("package:$packageName")
            ))
        } catch (_: Exception) {
            // 部分国产 ROM 没有这个设置页，跳不过去就算了，Toast 已经说清楚路径
        }
    }

    private fun handleShareIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val type = intent.type ?: return

        if (type.startsWith("text/")) {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
            // ⚠️ 0726 修：原来是 webView.post + 「函数存在才调」。onCreate 里页面还一片空白，
            // 分享进来的文字每次都掉在地上——而且前端从来就没定义过 __yanjiShareText，
            // 短路写法让它安静了大半个月。现在走 callWeb（排队 + 重试），前端也补上了这个函数。
            callWeb("__yanjiShareText", text)
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
        // 通知权限被拒之后要有交代（0804）。原来这里只处理录音权限，
        // POST_NOTIFICATIONS 被拒是**静默**的：消息和来电通知从此都不出现，
        // 而系统那个授权弹窗一旦拒过两次就不会再弹，她也没有第二个入口回去开。
        if (requestCode == NOTIFICATION_PERM_CODE &&
            (grantResults.isEmpty() || grantResults[0] != PackageManager.PERMISSION_GRANTED)) {
            AlertDialog.Builder(this)
                .setTitle("还没有打开通知")
                .setMessage("这样会收不到消息和来电提醒。你可以现在去通知设置打开，也可以以后再改。")
                .setNegativeButton("知道了", null)
                .setPositiveButton("去通知设置") { _, _ ->
                    try {
                        startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                            putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                        })
                    } catch (_: Exception) {
                        Toast.makeText(this, "没能打开通知设置，请在系统设置里找到言叽", Toast.LENGTH_LONG).show()
                    }
                }
                .show()
        } else if (requestCode == AUDIO_PERM_CODE) {
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
