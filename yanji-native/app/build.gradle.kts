plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

android {
    namespace = "cc.ravenlove.yanji"
    compileSdk = 35

    defaultConfig {
        applicationId = "cc.ravenlove.yanji"
        minSdk = 26
        targetSdk = 35
        // versionCode 跟 CI run number 走：每个新包都是「升级」，同签名可直接覆盖安装
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    signingConfigs {
        // CI 从 GH secret 还原固定 keystore 时启用；签名稳定=更新不再冲突（此前
        // assembleDebug 每次随机生成 debug keystore，也是 FIS_AUTH_ERROR 白名单坑的根源）
        val ksPath = System.getenv("YANJI_KEYSTORE_FILE")
        if (!ksPath.isNullOrBlank()) {
            create("stable") {
                storeFile = file(ksPath)
                storeType = "PKCS12"
                storePassword = System.getenv("YANJI_KEYSTORE_PASS") ?: "android"
                keyAlias = "yanji"
                keyPassword = System.getenv("YANJI_KEYSTORE_PASS") ?: "android"
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
    implementation("androidx.media:media:1.7.0")

    // FCM push
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")

    // coroutines for QuickReplyReceiver
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
