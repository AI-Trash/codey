// Top-level build file where you can add configuration options common to all sub-projects/modules.
import com.android.build.api.dsl.ApplicationExtension
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Properties
import org.gradle.api.Project

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
}

subprojects {
    plugins.withId("com.android.application") {
        val signing = readCodeyAndroidSigningConfig()
        if (signing != null) {
            extensions.configure<ApplicationExtension>("android") {
                val sharedSigningConfig = signingConfigs.create("codeyShared") {
                    storeFile = file(signing.storeFile)
                    storePassword = signing.storePassword
                    keyAlias = signing.keyAlias
                    keyPassword = signing.keyPassword
                }

                buildTypes.configureEach {
                    signingConfig = sharedSigningConfig
                }
            }
        }
    }
}

tasks.register("verifyDebugApkSignatures") {
    group = "verification"
    description = "Verifies that the Codey app and automator host debug APKs share the same signing certificate."
    dependsOn(":app:assembleDebug", ":automator-host:assembleDebug")

    doLast {
        val apksigner = findApkSigner()
        val appApk = rootProject.file("app/build/outputs/apk/debug/app-debug.apk")
        val hostApk = rootProject.file("automator-host/build/outputs/apk/debug/automator-host-debug.apk")
        val appDigest = readCertificateSha256(apksigner, appApk)
        val hostDigest = readCertificateSha256(apksigner, hostApk)

        if (appDigest != hostDigest) {
            throw GradleException(
                "Debug APK signatures do not match: app=$appDigest automator-host=$hostDigest"
            )
        }

        logger.lifecycle("Debug APK signatures match: $appDigest")
    }
}

tasks.register("installCodeyDebug") {
    group = "install"
    description = "Installs or updates both CodeyApp and the automator host debug APKs on the connected device."
    dependsOn("verifyDebugApkSignatures")

    doLast {
        val adb = findAdb()
        runCheckedCommand(adb, "install", "-r", "app/build/outputs/apk/debug/app-debug.apk")
        runCheckedCommand(
            adb,
            "install",
            "-r",
            "automator-host/build/outputs/apk/debug/automator-host-debug.apk"
        )
    }
}

data class CodeyAndroidSigningConfig(
    val storeFile: String,
    val storePassword: String,
    val keyAlias: String,
    val keyPassword: String
)

fun Project.readCodeyAndroidSigningConfig(): CodeyAndroidSigningConfig? {
    val values = mapOf(
        "store file" to codeySigningValue(
            "codeyAndroidSigningStoreFile",
            "CODEY_ANDROID_SIGNING_STORE_FILE"
        ),
        "store password" to codeySigningValue(
            "codeyAndroidSigningStorePassword",
            "CODEY_ANDROID_SIGNING_STORE_PASSWORD"
        ),
        "key alias" to codeySigningValue(
            "codeyAndroidSigningKeyAlias",
            "CODEY_ANDROID_SIGNING_KEY_ALIAS"
        ),
        "key password" to codeySigningValue(
            "codeyAndroidSigningKeyPassword",
            "CODEY_ANDROID_SIGNING_KEY_PASSWORD"
        )
    )
    if (values.values.all { it == null }) {
        return null
    }

    val missing = values.filterValues { it == null }.keys
    if (missing.isNotEmpty()) {
        throw GradleException(
            "Android signing is partially configured. Missing: ${missing.joinToString()}."
        )
    }

    return CodeyAndroidSigningConfig(
        storeFile = values.getValue("store file")!!,
        storePassword = values.getValue("store password")!!,
        keyAlias = values.getValue("key alias")!!,
        keyPassword = values.getValue("key password")!!
    )
}

fun Project.codeySigningValue(gradleProperty: String, environmentVariable: String): String? {
    return providers
        .gradleProperty(gradleProperty)
        .orElse(providers.environmentVariable(environmentVariable))
        .orNull
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
}

fun findApkSigner(): File {
    val sdkDir = findAndroidSdkDir()
    val buildToolsDir = sdkDir.resolve("build-tools")
    val executableName = if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true)) {
        "apksigner.bat"
    } else {
        "apksigner"
    }
    return buildToolsDir
        .listFiles()
        .orEmpty()
        .sortedByDescending { it.name }
        .map { it.resolve(executableName) }
        .firstOrNull { it.isFile }
        ?: throw GradleException("Unable to find $executableName under $buildToolsDir")
}

fun findAdb(): File {
    val sdkDir = findAndroidSdkDir()
    val executableName = if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true)) {
        "adb.exe"
    } else {
        "adb"
    }
    return sdkDir
        .resolve("platform-tools")
        .resolve(executableName)
        .takeIf { it.isFile }
        ?: throw GradleException("Unable to find $executableName under ${sdkDir.resolve("platform-tools")}")
}

fun findAndroidSdkDir(): File {
    val localProperties = rootProject.file("local.properties")
    if (localProperties.isFile) {
        val properties = Properties()
        localProperties.inputStream().use { properties.load(it) }
        val sdkDir = properties.getProperty("sdk.dir")?.trim()
        if (!sdkDir.isNullOrEmpty()) {
            return File(sdkDir)
        }
    }

    val sdkDir = System.getenv("ANDROID_HOME") ?: System.getenv("ANDROID_SDK_ROOT")
    if (!sdkDir.isNullOrBlank()) {
        return File(sdkDir)
    }

    throw GradleException("Unable to locate Android SDK from local.properties, ANDROID_HOME, or ANDROID_SDK_ROOT.")
}

fun readCertificateSha256(apksigner: File, apk: File): String {
    if (!apk.isFile) {
        throw GradleException("APK does not exist: $apk")
    }

    val process = ProcessBuilder(
        apksigner.absolutePath,
        "verify",
        "--print-certs",
        apk.absolutePath
    )
        .redirectErrorStream(true)
        .start()
    val output = ByteArrayOutputStream()
    process.inputStream.use { input ->
        input.copyTo(output)
    }
    val exitCode = process.waitFor()
    if (exitCode != 0) {
        throw GradleException(
            "apksigner failed for $apk with exit code $exitCode:\n$output"
        )
    }

    val text = output.toString(Charsets.UTF_8)
    return Regex("certificate SHA-256 digest:\\s*([0-9a-fA-F]+)")
        .find(text)
        ?.groupValues
        ?.get(1)
        ?.lowercase()
        ?: throw GradleException("Unable to read signing certificate SHA-256 from $apk")
}

fun runCheckedCommand(command: File, vararg args: String) {
    val process = ProcessBuilder(command.absolutePath, *args)
        .redirectErrorStream(true)
        .start()
    val output = ByteArrayOutputStream()
    process.inputStream.use { input ->
        input.copyTo(output)
    }
    val exitCode = process.waitFor()
    val commandText = listOf(command.absolutePath, *args).joinToString(" ")
    if (exitCode != 0) {
        throw GradleException("$commandText failed with exit code $exitCode:\n$output")
    }
    print(output.toString(Charsets.UTF_8))
}
