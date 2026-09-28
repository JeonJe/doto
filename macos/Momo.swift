import AppKit
import WebKit

final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var panel: NSWindow!
    private var noticePanel: PetPanel!
    private var web: WKWebView!
    private var status: NSStatusItem!
    private var backend: Process?
    private var output: Pipe?
    private var timer: Timer?
    private var loaded = false
    private var quitting = false
    private var notice = false
    private var seen = Set<String>()
    private var origin = ""
    private var backendPort = 0
    private var backendOutput = ""
    private var diagnosticsURL: URL?

    private func record(_ event: String) {
        guard let url = diagnosticsURL else { return }
        let line = "\(Date()) \(event)\n"
        if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(line.utf8))
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        setupMenu()
        setupPanel()
        startBackend()
    }

    private func setupMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        let quit = NSMenuItem(title: "도토 종료", action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        appMenu.addItem(quit)
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)
        let editItem = NSMenuItem(title: "편집", action: nil, keyEquivalent: "")
        let edit = NSMenu(title: "편집")
        for (title, selector, key) in [("실행 취소", "undo:", "z"), ("잘라내기", "cut:", "x"), ("복사", "copy:", "c"), ("붙여넣기", "paste:", "v"), ("전체 선택", "selectAll:", "a")] {
            edit.addItem(NSMenuItem(title: title, action: Selector(selector), keyEquivalent: key))
        }
        editItem.submenu = edit
        mainMenu.addItem(editItem)
        let windowItem = NSMenuItem(title: "윈도우", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "윈도우")
        windowMenu.addItem(NSMenuItem(title: "창 닫기", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
        windowMenu.addItem(NSMenuItem(title: "최소화", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        windowMenu.addItem(NSMenuItem(title: "확대/축소", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: ""))
        let fullScreen = NSMenuItem(title: "전체 화면", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        windowMenu.addItem(fullScreen)
        windowItem.submenu = windowMenu
        mainMenu.addItem(windowItem)
        NSApp.windowsMenu = windowMenu
        NSApp.mainMenu = mainMenu
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "도토"
        status.button?.toolTip = "도토, 새 버전을 모으는 다람쥐"
        let menu = NSMenu()
        for (title, action) in [("도토 열기", #selector(showPet)), ("도토 숨기기", #selector(hidePet))] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
            item.target = self
            menu.addItem(item)
        }
        menu.addItem(.separator())
        let info = NSMenuItem(title: "앱이 켜져 있을 때 새 버전을 확인해요", action: nil, keyEquivalent: "")
        info.isEnabled = false
        menu.addItem(info)
        let exit = NSMenuItem(title: "도토 종료", action: #selector(quitApp), keyEquivalent: "q")
        exit.target = self
        menu.addItem(exit)
        status.menu = menu
    }

    private func setupPanel() {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "momo")
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.autoresizingMask = [.width, .height]
        panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 470, height: 720), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        panel.title = "도토"
        panel.isReleasedWhenClosed = false
        panel.contentMinSize = NSSize(width: 400, height: 520)
        panel.backgroundColor = .white
        panel.collectionBehavior = [.fullScreenPrimary]
        panel.contentView = NSView(frame: panel.contentView!.bounds)
        attachWeb(to: panel)
        panel.center()
        panel.setFrameUsingName("DotoMainWindow")
        panel.setFrameAutosaveName("DotoMainWindow")
        panel.delegate = self

        noticePanel = PetPanel(contentRect: NSRect(x: 0, y: 0, width: 380, height: 280), styleMask: [.borderless], backing: .buffered, defer: false)
        noticePanel.isReleasedWhenClosed = false
        noticePanel.level = .floating
        noticePanel.isFloatingPanel = true
        noticePanel.hidesOnDeactivate = false
        noticePanel.backgroundColor = .clear
        noticePanel.isOpaque = false
        noticePanel.hasShadow = true
        noticePanel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    }

    private func attachWeb(to window: NSWindow) {
        guard let container = window.contentView else { return }
        web.removeFromSuperview()
        web.frame = container.bounds
        container.addSubview(web)
    }

    private func placeNotice() {
        guard let screen = panel.screen ?? NSScreen.main ?? NSScreen.screens.first else { return }
        let area = screen.visibleFrame
        noticePanel.setFrameOrigin(NSPoint(x: area.maxX - noticePanel.frame.width - 22, y: area.minY + 35))
    }

    private func startBackend() {
        guard let resources = Bundle.main.resourceURL else { fail("앱 리소스를 찾지 못했어요."); return }
        do {
            let fm = FileManager.default
            let storage: URL
            if let custom = ProcessInfo.processInfo.environment["MOMO_DATA_DIR"], custom.hasPrefix("/") {
                storage = URL(fileURLWithPath: custom, isDirectory: true)
            } else {
                storage = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("MomoPrototype", isDirectory: true)
            }
            try fm.createDirectory(at: storage, withIntermediateDirectories: true)
            diagnosticsURL = storage.appendingPathComponent("desktop.log")
            if !fm.fileExists(atPath: diagnosticsURL!.path) { fm.createFile(atPath: diagnosticsURL!.path, contents: nil) }
            record("startup")
            let node = resources.appendingPathComponent("runtime/node")
            guard fm.isExecutableFile(atPath: node.path) else { fail("앱에 포함된 실행 파일을 찾지 못했어요."); return }
            let process = Process()
            process.executableURL = node
            process.arguments = [resources.appendingPathComponent("web/server.mjs").path]
            process.currentDirectoryURL = storage
            var env = ProcessInfo.processInfo.environment
            let home = fm.homeDirectoryForCurrentUser.path
            let nvmRoot = URL(fileURLWithPath: home + "/.nvm/versions/node")
            let nvmBins = ((try? fm.contentsOfDirectory(at: nvmRoot, includingPropertiesForKeys: nil)) ?? []).sorted { $0.lastPathComponent.compare($1.lastPathComponent, options: .numeric) == .orderedDescending }.map { $0.appendingPathComponent("bin").path }
            let paths = [resources.appendingPathComponent("runtime").path, home + "/.local/bin", home + "/.grok/bin", home + "/.bun/bin", "/opt/homebrew/bin", "/usr/local/bin"] + nvmBins + [env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"]
            env["PATH"] = env["MOMO_TOOL_PATH"] ?? paths.joined(separator: ":")
            env["HOME"] = home
            env["MOMO_PORT"] = "0"
            env.removeValue(forKey: "NODE_OPTIONS")
            env.removeValue(forKey: "NODE_PATH")
            env["MOMO_DATA_DIR"] = storage.path
            env["MOMO_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
            process.environment = env
            let pipe = Pipe()
            output = pipe
            process.standardOutput = pipe
            let logURL = storage.appendingPathComponent("backend.log")
            if !fm.fileExists(atPath: logURL.path) { fm.createFile(atPath: logURL.path, contents: nil) }
            let log = try FileHandle(forWritingTo: logURL)
            try log.seekToEnd()
            process.standardError = log
            pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let bytes = handle.availableData
                guard !bytes.isEmpty, let text = String(data: bytes, encoding: .utf8) else { return }
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.backendOutput += text
                    while let newline = self.backendOutput.firstIndex(of: "\n") {
                        let line = String(self.backendOutput[..<newline])
                        self.backendOutput.removeSubrange(...newline)
                        let prefix = "MOMO http://127.0.0.1:"
                        if line.hasPrefix(prefix), let port = Int(line.dropFirst(prefix.count)), (1...65535).contains(port) { self.backendReady(port: port) }
                    }
                }
            }
            process.terminationHandler = { [weak self] process in
                DispatchQueue.main.async {
                    guard let self, !self.quitting else { return }
                    self.record("backend exited status=\(process.terminationStatus)")
                    self.fail("도토의 연결이 종료됐어요. 앱을 다시 열어 주세요.")
                }
            }
            backend = process
            try process.run()
            DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
                guard let self, !self.loaded, !self.quitting else { return }
                self.fail("로컬 연결을 준비하지 못했어요. 도토를 다시 실행해 주세요.")
            }
        } catch { fail("도토를 실행하지 못했어요: \(error.localizedDescription)") }
    }

    private func backendReady(port: Int) {
        guard !loaded else { return }
        backendPort = port
        origin = "http://127.0.0.1:\(port)"
        loaded = true
        record("backend ready port=\(port)")
        web.load(URLRequest(url: URL(string: origin)!))
        timer = Timer(timeInterval: 4, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(timer!, forMode: .common)
    }

    private func poll() {
        var request = URLRequest(url: URL(string: origin + "/api/state")!)
        request.timeoutInterval = 3
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            if let error { DispatchQueue.main.async { self?.record("poll error: \(error.localizedDescription)") }; return }
            guard let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let notifications = json["notifications"] as? [[String: Any]], let id = notifications.last?["id"] as? String else { return }
            DispatchQueue.main.async { self?.receiveNotification(id: id) }
        }.resume()
    }

    private func receiveNotification(id: String) {
        guard !seen.contains(id) else { return }
        record("notification \(id) visible=\(panel.isVisible)")
        seen.insert(id)
        status.button?.title = "도토 ✧"
        if !panel.isVisible || panel.isMiniaturized || notice {
            notice = true
            attachWeb(to: noticePanel)
            placeNotice()
            web.evaluateJavaScript("refresh().then(() => window.momoDesktop?.notification())", completionHandler: nil)
            noticePanel.orderFrontRegardless()
            record("notice presented visible=\(noticePanel.isVisible)")
        }
    }

    @objc private func showPet() {
        noticePanel.orderOut(nil)
        attachWeb(to: panel)
        notice = false
        if panel.isMiniaturized { panel.deminiaturize(nil) }
        status.button?.title = "도토"
        web.evaluateJavaScript("window.momoDesktop?.open()", completionHandler: nil)
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    @objc private func hidePet() { panel.orderOut(nil); noticePanel.orderOut(nil); record("hidden visible=\(panel.isVisible)") }
    @objc private func quitApp() { NSApp.terminate(nil) }
    private func fail(_ text: String) {
        guard !quitting else { return }
        quitting = true
        let alert = NSAlert()
        alert.messageText = "도토를 열지 못했어요"
        alert.informativeText = text
        alert.runModal()
        NSApp.terminate(nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "127.0.0.1", message.frameInfo.securityOrigin.port == backendPort,
              let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "hide": hidePet()
        case "show": showPet()
        case "openExternal":
            let allowedHosts = ["github.com", "www.npmjs.com", "formulae.brew.sh", "code.claude.com", "developers.openai.com", "learn.chatgpt.com", "opencode.ai", "bun.sh", "bun.com", "geminicli.com", "docs.x.ai"]
            if let value = body["url"] as? String, let url = URL(string: value), url.scheme == "https", allowedHosts.contains(url.host ?? "") { NSWorkspace.shared.open(url) }
        case "notification": if let id = body["id"] as? String { receiveNotification(id: id) }
        default: break
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { showPet() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        decisionHandler(url.scheme == "http" && url.host == "127.0.0.1" && url.port == backendPort ? .allow : .cancel)
    }
    func windowDidMiniaturize(_ notification: Notification) { record("minimized=\(panel.isMiniaturized)") }
    func windowDidDeminiaturize(_ notification: Notification) {
        record("restored minimized=\(panel.isMiniaturized)")
        if notice { showPet() }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { hidePet(); return false }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showPet(); return true }
    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        timer?.invalidate()
        output?.fileHandleForReading.readabilityHandler = nil
        if backend?.isRunning == true { backend?.terminate() }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
