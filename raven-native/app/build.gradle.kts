plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

android {
    namespace = "cc.ravenlove.roost"
    compileSdk = 35

    defaultConfig {
        applicationId = "cc.ravenlove.roost"
        minSdk = 26
        targetSdk = 35
        // versionCode 跟 CI run number 走：每个新包都是「升级」，同签名可直接覆盖安装。
        // 版本检查也是拿它跟服务端返回的构建号比大小（见 MainActivity.checkUpdate）
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
        buildConfigField("String", "BUILD_NUMBER", "\"" + (System.getenv("GITHUB_RUN_NUMBER") ?: "0") + "\"")
    }

    signingConfigs {
        // 签名固定 + applicationId 不变 + versionCode 递增，三条齐了覆盖安装才不冲突、
        // 数据才留得住。早期 assembleDebug 每次随机生成 debug keystore，是更新冲突和
        // FIS_AUTH_ERROR 的根源。
        //
        // ⚠️ 直接复用言叽那把 keystore（secret YANJI_KEYSTORE_B64），不新建。
        // 理由：自分发的 APK 不上架 Play，两个自己的 app 共用一把签名key完全正常，
        // 而新建 key 需要人去 GitHub 网页里加 secret——能省掉的手工步骤就省掉。
        // 所以 alias 必须是 "yanji"（keystore 里就这一个条目），不是 "roost"。
        val ksPath = System.getenv("ROOST_KEYSTORE_FILE")
        if (!ksPath.isNullOrBlank()) {
            create("stable") {
                storeFile = file(ksPath)
                storeType = "PKCS12"
                storePassword = System.getenv("ROOST_KEYSTORE_PASS") ?: "android"
                keyAlias = System.getenv("ROOST_KEYSTORE_ALIAS") ?: "yanji"
                keyPassword = System.getenv("ROOST_KEYSTORE_PASS") ?: "android"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("stable")?.let { signingConfig = it }
        }
        debug {
            isMinifyEnabled = false
            signingConfigs.findByName("stable")?.let { signingConfig = it }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")

    // FCM push
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")

    // coroutines：通知栏快捷回复的后台发送
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
