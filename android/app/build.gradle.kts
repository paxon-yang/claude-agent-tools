plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 签名：有 ANDROID_KEYSTORE（GitHub 机密）就用它；没有就用仓库里公开的 public-release.jks
// Signing: ANDROID_KEYSTORE (a GitHub secret) when set, otherwise the public key committed in this folder
val ksFile = System.getenv("ANDROID_KEYSTORE_FILE")?.let { file(it) } ?: file("public-release.jks")
val ksPass = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: "agentcard"
val ksAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "agentcard"

android {
    namespace = "io.github.paxonyang.agentcard"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.paxonyang.agentcard"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "0.1." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    signingConfigs {
        create("release") {
            storeFile = ksFile
            storePassword = ksPass
            keyAlias = ksAlias
            keyPassword = ksPass
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        abortOnError = true
        warningsAsErrors = false
        disable += setOf("GradleDependency", "OldTargetApi", "NewerVersionAvailable", "AndroidGradlePluginVersion")
    }
}

dependencies {
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.work:work-runtime:2.9.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
