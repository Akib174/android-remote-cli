plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp") version "2.0.20-1.0.25"
}

android {
    namespace = "com.fcfc.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.fcfc.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "1.0.3"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "/META-INF/versions/9/OSGI-INF/MANIFEST.MF"
        }
    }
    testOptions {
        unitTests.isIncludeAndroidResources = false
    }
}

dependencies {
    // Compose
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-text")
    implementation("androidx.compose.animation:animation")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.compose.ui:ui-tooling-preview")

    // AndroidX core
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.exifinterface:exifinterface:1.3.7")

    // Kotlinx
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // Networking + WS
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Images (emoji artwork, avatars, media — webp animated support)
    implementation("io.coil-kt:coil-compose:2.7.0")

    // WebRTC (Cloudflare Realtime SFU calls) — maintained prebuilt
    implementation("io.getstream:stream-webrtc-android:1.1.3")

    // Crypto: X25519/P-256 ECDH, ECDSA, HKDF via BouncyCastle + JCA
    implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")

    // Room
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // Tests
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("org.jetbrains.kotlin:kotlin-test:2.0.20")
}
