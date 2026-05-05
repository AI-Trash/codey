plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.codey.automatorhost"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.codey.automatorhost"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }
}
