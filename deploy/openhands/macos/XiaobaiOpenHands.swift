import Cocoa
import WebKit

@main
final class XiaobaiOpenHandsApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
  private let appTitle = "小白 OpenHands"
  private var window: NSWindow!
  private var webView: WKWebView!
  private var loadingView: NSView!
  private var loadingLabel: NSTextField!
  private var spinner: NSProgressIndicator!
  private var actionStack: NSStackView!
  private var currentCanvasURL: URL?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    buildMenu()
    createWindow()
    startAndLoadCanvas()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  private func buildMenu() {
    let mainMenu = NSMenu(title: appTitle)
    let appMenuItem = NSMenuItem()
    let appMenu = NSMenu(title: appTitle)

    appMenu.addItem(menuItem("重新连接/启动", action: #selector(retryStartup), key: "r"))
    appMenu.addItem(menuItem("配置模型", action: #selector(configureModel), key: ","))
    appMenu.addItem(menuItem("在浏览器中打开", action: #selector(openInBrowser), key: "b"))
    appMenu.addItem(menuItem("停止服务", action: #selector(stopService), key: "s"))
    appMenu.addItem(NSMenuItem.separator())
    appMenu.addItem(menuItem("退出小白 OpenHands", action: #selector(NSApplication.terminate(_:)), key: "q", target: NSApp))

    appMenuItem.submenu = appMenu
    mainMenu.addItem(appMenuItem)
    NSApp.mainMenu = mainMenu
  }

  private func menuItem(_ title: String, action: Selector, key: String, target: AnyObject? = nil) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
    item.target = target ?? self
    return item
  }

  private func createWindow() {
    let frame = NSRect(x: 0, y: 0, width: 1280, height: 860)
    window = NSWindow(
      contentRect: frame,
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = appTitle
    window.minSize = NSSize(width: 1024, height: 720)
    window.delegate = self

    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = true

    webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = self
    webView.allowsBackForwardNavigationGestures = true

    let contentView = NSView(frame: frame)
    window.contentView = contentView

    contentView.addSubview(webView)
    webView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      webView.topAnchor.constraint(equalTo: contentView.topAnchor),
      webView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
    ])

    loadingView = NSView(frame: .zero)
    loadingView.wantsLayer = true
    loadingView.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

    spinner = NSProgressIndicator()
    spinner.style = .spinning
    spinner.controlSize = .large
    spinner.startAnimation(nil)

    loadingLabel = NSTextField(labelWithString: "")
    loadingLabel.alignment = .center
    loadingLabel.maximumNumberOfLines = 0
    loadingLabel.lineBreakMode = .byWordWrapping
    loadingLabel.font = NSFont.systemFont(ofSize: 15)
    loadingLabel.textColor = .secondaryLabelColor

    let titleLabel = NSTextField(labelWithString: appTitle)
    titleLabel.alignment = .center
    titleLabel.font = NSFont.boldSystemFont(ofSize: 24)

    let retryButton = NSButton(title: "重新启动", target: self, action: #selector(retryStartup))
    let configureButton = NSButton(title: "配置模型", target: self, action: #selector(configureModel))
    let browserButton = NSButton(title: "用浏览器打开", target: self, action: #selector(openInBrowser))

    actionStack = NSStackView(views: [retryButton, configureButton, browserButton])
    actionStack.orientation = .horizontal
    actionStack.alignment = .centerY
    actionStack.spacing = 12
    actionStack.isHidden = true

    let stack = NSStackView(views: [spinner, titleLabel, loadingLabel, actionStack])
    stack.orientation = .vertical
    stack.alignment = .centerX
    stack.spacing = 18
    stack.edgeInsets = NSEdgeInsets(top: 24, left: 40, bottom: 24, right: 40)

    loadingView.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    loadingLabel.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: loadingView.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: loadingView.centerYAnchor),
      stack.widthAnchor.constraint(lessThanOrEqualToConstant: 620),
      loadingLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 560),
    ])

    contentView.addSubview(loadingView)
    loadingView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      loadingView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
      loadingView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      loadingView.topAnchor.constraint(equalTo: contentView.topAnchor),
      loadingView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
    ])

    window.center()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  private func setLoading(_ message: String, spinning: Bool, showActions: Bool) {
    loadingView.isHidden = false
    loadingLabel.stringValue = message
    actionStack.isHidden = !showActions
    if spinning {
      spinner.isHidden = false
      spinner.startAnimation(nil)
    } else {
      spinner.stopAnimation(nil)
      spinner.isHidden = true
    }
  }

  private func hideLoading() {
    spinner.stopAnimation(nil)
    loadingView.isHidden = true
  }

  private func startAndLoadCanvas() {
    setLoading(
      "正在启动本机服务…\n首次运行会解压应用数据并等待 Docker Desktop 就绪。",
      spinning: true,
      showActions: false
    )

    runHelper(["--start-window"]) { [weak self] status, output in
      guard let self else { return }
      guard status == 0, let url = self.extractCanvasURL(from: output) else {
        self.setLoading(
          "启动没有完成。\n如果刚刚打开了配置文件，请填写 LLM_API_KEY 和 LLM_MODEL，保存后点击“重新启动”。\n也可以从菜单选择“配置模型”或“停止服务”。",
          spinning: false,
          showActions: true
        )
        return
      }

      self.currentCanvasURL = url
      self.setLoading("服务已启动，正在打开 Canvas…", spinning: true, showActions: false)
      self.webView.load(URLRequest(url: url))
    }
  }

  private func extractCanvasURL(from output: String) -> URL? {
    for line in output.components(separatedBy: .newlines) {
      let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
        return URL(string: trimmed)
      }
    }
    return nil
  }

  private func helperPath() throws -> String {
    guard let executableDirectory = Bundle.main.executableURL?.deletingLastPathComponent() else {
      throw NSError(domain: appTitle, code: 1, userInfo: [NSLocalizedDescriptionKey: "无法定位应用目录。"])
    }
    let helper = executableDirectory.appendingPathComponent("XiaobaiOpenHandsLauncher").path
    guard FileManager.default.fileExists(atPath: helper) else {
      throw NSError(domain: appTitle, code: 2, userInfo: [NSLocalizedDescriptionKey: "应用启动助手不存在。"])
    }
    return helper
  }

  private func runHelper(_ arguments: [String], completion: @escaping (Int32, String) -> Void = { _, _ in }) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let helper = try self.helperPath()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [helper] + arguments

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        try process.run()
        process.waitUntilExit()

        let stdout = String(data: outputPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let stderr = String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let output = stderr.isEmpty ? stdout : stdout + "\n" + stderr
        DispatchQueue.main.async {
          completion(process.terminationStatus, output)
        }
      } catch {
        DispatchQueue.main.async {
          completion(126, error.localizedDescription)
        }
      }
    }
  }

  @objc private func retryStartup() {
    startAndLoadCanvas()
  }

  @objc private func configureModel() {
    runHelper(["--configure"])
  }

  @objc private func openInBrowser() {
    if let currentCanvasURL {
      NSWorkspace.shared.open(currentCanvasURL)
      return
    }
    runHelper(["--open"])
  }

  @objc private func stopService() {
    setLoading("正在停止本机服务…", spinning: true, showActions: false)
    runHelper(["--stop"]) { [weak self] status, _ in
      guard let self else { return }
      if status == 0 {
        self.setLoading("服务已停止。再次使用时点击“重新启动”。", spinning: false, showActions: true)
      } else {
        self.setLoading("停止服务没有完成，请查看应用日志后重试。", spinning: false, showActions: true)
      }
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    hideLoading()
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    setLoading("Canvas 加载失败：\(error.localizedDescription)", spinning: false, showActions: true)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    setLoading("Canvas 暂时不可访问：\(error.localizedDescription)", spinning: false, showActions: true)
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard
      navigationAction.navigationType == .linkActivated,
      let url = navigationAction.request.url,
      let host = url.host?.lowercased()
    else {
      decisionHandler(.allow)
      return
    }

    if host != "localhost" && host != "127.0.0.1" {
      NSWorkspace.shared.open(url)
      decisionHandler(.cancel)
      return
    }

    decisionHandler(.allow)
  }
}
