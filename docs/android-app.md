# 安卓离线 App（Capacitor 壳）

> 2026-10-19。结论：**不需要 C++/原生重写**——PWA 代码原样打包进 APK，只在两处
> WebView 缺口上加原生桥：TTS（WebView 无 Web Speech API）和屏幕常亮（无 Wake
> Lock API）。68/68 webapp 单测、43/43 converter 单测保持全绿，浏览器/PWA 路径零改动。

## 架构

```
webapp (Preact PWA, 不动)  ──vite build --mode native──▶  dist/  ──cap sync──▶  android/ (Capacitor 6)
     │                                                                      │
     │ src/native/native.ts（仅 native 模式加载）                              APK
     │   · window.speechSynthesis shim ──▶ @capacitor-community/text-to-speech
     │   · navigator.wakeLock shim ──────▶ @capacitor-community/keep-awake
     ▼
浏览器 / PWA 路径：shim 不加载，speechSynthesis / wakeLock 原生自持
```

关键点：

- **上层代码零改动**：Speaker / Settings / WakeLockHolder 照旧读写
  `window.speechSynthesis` 和 `navigator.wakeLock`，shim 在 main.tsx 挂载前装好。
- **shim 必须 `Object.defineProperty`**：WebView 里 `navigator.wakeLock` 是只有
  getter 的自有属性，直接赋值抛 TypeError（首版踩坑，BOOT ERROR 横幅抓出）。
- **TTS voice 映射**：插件的 `speak({voice})` 是**索引**——安卓 `getVoices()` 按
  name 排序后的下标；shim 里缓存 `getSupportedVoices()`（返回的就是
  SpeechSynthesisVoice 形状），按 `u.voice.name` 找下标传下去。QueueStrategy=Flush
  自带 stop-before-speak，等于 Web Speech 的 cancel 语义。
- **引擎晚就绪**：引擎 init ~1s，之前 `getSupportedVoices` 返回空——shim 500ms
  轮询至多 20 次，耗尽后 getVoices() 被调时还有 4 次复活机会；之后仍无音色则
  Speaker 走蜂鸣兜底（既有特性）。
- **竖屏**：manifest `android:screenOrientation="portrait"`（WebView 不支持
  `screen.orientation.lock`，原生层直接锁死，iOS 补偿逻辑用不上但无害）。
- **震动**：`navigator.vibrate` 在 WebView 可用，前提 manifest 加
  `android.permission.VIBRATE`（已加）。
- **service worker 不打进 APK**（`vite build --mode native` 跳过 VitePWA）：
  资产全在本地，SW 只会变成过期缓存层。所以 **PWA 构建和 native 构建是两条命令，
  同步前必须 `npm run sync:native`**（= build:native + cap sync），别把 PWA 版
  dist 同步进 APK。

## 构建

环境：JDK17 = `D:\AndroidSdk\jdk-17.0.20.1+1`；SDK = `D:\AndroidSdk`
（platforms;android-34 + build-tools;34.0.0 + platform-tools）；gradle wrapper
已改用本机缓存的 **gradle-8.5-bin**（8.2.1-all 下载两次中断，AGP 8.2 兼容 8.5）。

```bash
cd webapp
npm run sync:native                    # build:native + cap sync android
cd android
export JAVA_HOME="D:/AndroidSdk/jdk-17.0.20.1+1"
./gradlew.bat assembleRelease          # 产物 app/build/outputs/apk/release/app-release.apk (~3MB)
./gradlew.bat assembleDebug            # 调试包（WebView 可远程调试）
```

注意 gradlew 的失败退出码会被管道 `| tail` 吞掉，脚本里要自己判 `$?`。

## 签名

- keystore：`webapp/android/keystore/weldassist.keystore`，alias `weldassist`，
  密码 `weldassist2026`（同目录 keystore.properties）。**有意提交进 git**：
  丢了签名 = 用户必须卸载重装 = IndexedDB 任务/断点数据全没；个人侧载应用，
  密钥不是安全边界。换密码需同步改 keystore.properties。
- app/build.gradle 里 release signingConfig 从 keystore.properties 读。

## 装到手机

1. APK 传手机（QQ 文件传输助手/数据线随意）：
   `webapp/android/app/build/outputs/apk/release/app-release.apk`
2. 点开安装（需允许「安装未知应用」）。
3. 首启：设置里点「TTS 体检 → 播放测试句」；无声则去系统设置装中文离线语音包
   （Google TTS：设置→系统→辅助→TTS；国产 ROM 一般自带讯飞/小爱中文包）。
4. 任务文件照旧：examples/*.stj.json 传手机 → 首页「导入任务」。

与 PWA 的差异：装的是原生 App（有图标、有启动屏、竖屏锁死）；IndexedDB 数据
存 App 私有目录，卸载即清；返回键 = 退到后台（回到 App 从重启处恢复，
IndexedDB 断点语义不变）。

## 模拟器冒烟（2026-10-19，weld-test API34 无头，证据 docs/qa/native/）

| 项 | 结果 |
|---|---|
| 冷启动→首页（demo 任务卡片） | ✅ home.png |
| 报菜名屏（5 组点选+默认序） | ✅（走查通过） |
| 朝向标定屏（板框+J1/J2+角度钮） | ✅ calibrate.png |
| 焊接循环：批量询问→逐颗→完成推进 1/12→2/12 | ✅ run-advanced.png |
| 全屏点位图（真比例焊盘+脉冲+区域词） | ✅ fullscreen-map.png |
| 缩略图当前位脉冲+已完成标记 | ✅ run-advanced.png |
| 杀进程重启断点恢复（焊到 2/12） | ✅ kill-resume.png |
| 设置屏 + 音色枚举（421 音色/16 中文，自动选中 Chinese China） | ✅ settings-tts.png |
| TTS 真出声（dumpsys audio: AudioTrack CONTENT_TYPE_SPEECH started） | ✅ |
| 启动错误横幅（release 无控制台，错误打到屏幕） | ✅ boot-error-probe.png |

**模拟器 TTS 引擎**：google_apis 镜像自带 com.google.android.tts，zh-CN 音色
「Chinese China」可用——模拟器都能出声，真机只会更好。

## 待真机确认（并入 m5-done 门禁清单）

- 真机 TTS 音色听感/延迟（m4 清单 #1 #2）；震动反馈实感。
- 文件导入的 system picker 实操（模拟器未自动化；WebView `<input type=file>`
  由 Capacitor 桥接，理论可用，另有「粘贴 JSON」兜底）。
- 返回键行为（=退后台）是否顺手；不顺手在 backlog 里接 App 插件拦 backButton。
- 图标/启动屏在真机分辨率下的观感（源图 webapp/assets/，Pillow 从 pwa-512 放大）。

## 已知取舍 / backlog 候选

- gradle wrapper 用 8.5-bin（非 Cap6 官方 8.2.1-all）：网络反复断，8.5 与 AGP 8.2 兼容。
- @capacitor/assets（sharp 原生模块）在 Node24 装不上——图标用手写 Pillow 脚本生成
  后直接替换 res/mipmap-*、drawable*/splash.png；改图标时重跑即可（脚本历史在本
  文档 git 提交里）。
- 返回键拦截、蓝牙翻页器（v1.5 计划）、`--serve` 局域网实验仍在 backlog。
