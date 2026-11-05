import Cocoa
import WebKit

final class MulowDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var child: Process?
    var origin: URL?
    var stdoutBuffer = Data()
    var launchGeneration = 0
    var quitting = false
    var qaWritten = false
    var usingSavedKey = false
    var keychainSaveButton: NSButton?
    lazy var keychainConnection = MuseKeychainConnection(
        backend: NativeMuseKeychain(applicationPath: Bundle.main.executableURL!.path),
        consent: FileMuseConsent(directory: dataURL))
    let args = ProcessInfo.processInfo.arguments
    var dataURL: URL {
        if let i=args.firstIndex(of:"--data-directory"), args.count>i+1, args[i+1].hasPrefix("/") {
            return URL(fileURLWithPath:args[i+1],isDirectory:true)
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Mulow/v7-Mac",isDirectory:true)
    }
    var port: Int {
        if let i=args.firstIndex(of:"--port"),args.count>i+1,let value=Int(args[i+1]),value>=1024,value<=65535 {return value}
        return 43187
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        makeMenu()
        let config=WKWebViewConfiguration()
        do {
            try FileManager.default.createDirectory(at:dataURL,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            let profileFile=dataURL.appendingPathComponent("webkit-profile-id")
            let identifier: UUID
            if FileManager.default.fileExists(atPath:profileFile.path) {
                guard let saved=UUID(uuidString:try String(contentsOf:profileFile,encoding:.utf8)) else {throw NSError(domain:"Mulow",code:1)}
                identifier=saved
            } else {
                identifier=UUID()
                try Data(identifier.uuidString.utf8).write(to:profileFile,options:.atomic)
            }
            config.websiteDataStore=WKWebsiteDataStore(forIdentifier:identifier)
        } catch {
            let alert=NSAlert();alert.messageText="Could not open the Mulow data folder";alert.informativeText="The saved browser profile could not be read. No existing files were reset. Check the data folder and reopen Mulow.";alert.runModal();NSApp.terminate(nil);return
        }
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        web=WKWebView(frame:.zero,configuration:config)
        web.navigationDelegate=self; web.uiDelegate=self
        web.autoresizingMask=[.width,.height]
        window=NSWindow(contentRect:NSRect(x:0,y:0,width:1440,height:900),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.title="Mulow"; window.minSize=NSSize(width:900,height:640)
        window.contentView=web; window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps:true)
        startUsingApprovedConnection()
    }
    func startUsingApprovedConnection() {
        // Custom-data and QA launches never read the real saved key.
        guard !args.contains("--data-directory"), !args.contains("--qa-result"), keychainConnection.allowsAutomaticConnection else {
            usingSavedKey=false; start(key:""); return
        }
        do {
            if var value=try keychainConnection.loadAutomatically() {
                defer { value.resetBytes(in:0..<value.count) }
                usingSavedKey=true; start(key:String(decoding:value,as:UTF8.self))
            } else { usingSavedKey=false; start(key:"") }
        } catch {
            usingSavedKey=false; start(key:"")
            notice("Saved Muse connection unavailable", "macOS did not provide the saved Mulow key. No different Keychain item was read. Connect from the Mulow menu or resolve the macOS Keychain prompt yourself.")
        }
    }
    func makeMenu() {
        let root=NSMenu()
        let appItem=NSMenuItem(); root.addItem(appItem)
        let app=NSMenu(); appItem.submenu=app
        app.addItem(withTitle:"About Mulow",action:#selector(about),keyEquivalent:"")
        app.addItem(.separator())
        app.addItem(withTitle:"Connect Muse…",action:#selector(connectMuse),keyEquivalent:"k")
        app.addItem(withTitle:"Connect Muse for This Session…",action:#selector(connectMuseSession),keyEquivalent:"")
        app.addItem(withTitle:"Reconnect Saved Muse Key…",action:#selector(reconnectSavedMuse),keyEquivalent:"")
        app.addItem(withTitle:"Disable Saved Muse Access…",action:#selector(disableSavedMuse),keyEquivalent:"")
        app.addItem(withTitle:"Disconnect Muse…",action:#selector(disconnectMuse),keyEquivalent:"")
        app.addItem(withTitle:"Show Data Folder",action:#selector(showData),keyEquivalent:"")
        app.addItem(.separator()); app.addItem(withTitle:"Quit Mulow",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        let editItem=NSMenuItem(); root.addItem(editItem); let edit=NSMenu(title:"Edit"); editItem.submenu=edit
        for (title,selector,key) in [("Undo","undo:","z"),("Redo","redo:","Z"),("Cut","cut:","x"),("Copy","copy:","c"),("Paste","paste:","v"),("Select All","selectAll:","a")] {
            edit.addItem(withTitle:title,action:Selector(selector),keyEquivalent:key)
        }
        let viewItem=NSMenuItem(); root.addItem(viewItem); let view=NSMenu(title:"View"); viewItem.submenu=view
        view.addItem(withTitle:"Reload Workspace",action:#selector(reload),keyEquivalent:"r")
        view.addItem(withTitle:"Open in Browser",action:#selector(openBrowser),keyEquivalent:"")
        view.addItem(withTitle:"Toggle Full Screen",action:#selector(NSWindow.toggleFullScreen(_:)),keyEquivalent:"f")
        NSApp.mainMenu=root
    }
    func notice(_ title:String,_ message:String) {
        let a=NSAlert(); a.messageText=title; a.informativeText=message
        a.beginSheetModal(for:window,completionHandler:nil)
    }
    @objc func about() {
        notice("Mulow for Mac · v7.0.7", "Apple Silicon · based on verified v7\nSession-only connection or native Keychain after explicit local consent.\nThis build has an ad-hoc signature and is not notarized.")
    }
    @objc func showData() { NSWorkspace.shared.open(dataURL) }
    @objc func reload() { web.reload() }
    @objc func openBrowser() { if let url=origin { NSWorkspace.shared.open(url) } }
    func whenIdle(_ action:@escaping()->Void) {
        guard origin != nil else { return }
        web.callAsyncJavaScript("const s=await (await fetch('/api/status')).json(); return [...s.runs,...s.executionRuns].some(r=>r.status==='running'||Number(r.reservedUsd)>0);",arguments:[:],in:nil,in:.page) { result in
            switch result {
            case .success(let busy):
                if (busy as? Bool)==false { action() }
                else { self.notice("Workspace is busy", "Finish or stop the current work before changing the Muse connection.") }
            case .failure: self.notice("Connection unavailable", "Reload the workspace before changing the Muse connection.")
            }
        }
    }
    @objc func connectMuseSession() {
        whenIdle {
            let a=NSAlert(); a.messageText="Connect Muse for this session"
            a.informativeText="Enter your existing dedicated Baseten Muse API key. It stays in memory and is cleared when Mulow quits. The workspace reloads; save unsent text first. Connection is verified only when you approve and run model work."
            a.addButton(withTitle:"Connect"); a.addButton(withTitle:"Cancel")
            let field=NSSecureTextField(frame:NSRect(x:0,y:0,width:380,height:24))
            field.placeholderString="Existing dedicated API key"; a.accessoryView=field
            a.beginSheetModal(for:self.window) { response in
                defer { field.stringValue="" }
                guard response == .alertFirstButtonReturn else { return }
                let value=field.stringValue
                guard value.utf8.count>=16 && value.utf8.count<=1000 && value.utf8.allSatisfy({$0>=33 && $0<=126}) else {
                    self.notice("Key format not accepted", "Use the existing dedicated API key. No credential was saved."); return
                }
                self.usingSavedKey=false; self.restart(key:value)
            }
        }
    }
    func publishConnectionDialog(_ state:String, visible:Bool) {
        // Status metadata only. Never inspect or serialize the secure field.
        let value:[String:Any] = ["version":1,"dialog":state,"visible":visible,"time":ISO8601DateFormatter().string(from:Date())]
        let target=dataURL.appendingPathComponent("native-connection-status.json")
        if let data=try? JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]) {
            try? data.write(to:target,options:.atomic)
            try? FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:target.path)
        }
    }
    @objc func updateKeychainConsent(_ sender:NSButton) {
        keychainSaveButton?.isEnabled = sender.state == .on
    }
    @objc func connectMuse() {
        whenIdle {
            let a=NSAlert(); a.messageText="Save Muse key in this Mac's Keychain?"
            a.informativeText="Enter your existing dedicated Baseten Muse API key. Save & Connect adds only ‘Mulow Muse API Key’ (service: local.mulow.mac.v7.muse; account: dedicated-muse-api-key) to this Mac's login Keychain, without iCloud synchronization. It allows this Mulow application to use that item automatically at startup and send the key only to Baseten Muse for your requested model calls. It grants no key access to Codex or other applications. macOS may ask you to approve access, especially after an unsigned app update. Disable automatic access from the Mulow menu; remove the item yourself in Keychain Access. Session Only keeps the key in memory until quit. The workspace reloads; save unsent text first."
            let save=a.addButton(withTitle:"Save & Connect"); save.isEnabled=false
            a.addButton(withTitle:"Session Only"); a.addButton(withTitle:"Cancel")
            let view=NSView(frame:NSRect(x:0,y:0,width:480,height:66))
            let field=NSSecureTextField(frame:NSRect(x:0,y:38,width:480,height:24))
            field.placeholderString="Existing dedicated API key"
            let consent=NSButton(checkboxWithTitle:"Allow Keychain storage and automatic access by Mulow",target:self,action:#selector(self.updateKeychainConsent(_:)))
            consent.frame=NSRect(x:0,y:0,width:480,height:28); consent.state = .off
            view.addSubview(field); view.addSubview(consent); a.accessoryView=view
            self.keychainSaveButton=save
            a.beginSheetModal(for:self.window) { response in
                defer { field.stringValue=""; self.keychainSaveButton=nil; self.publishConnectionDialog("closed",visible:false) }
                guard response == .alertFirstButtonReturn || response == .alertSecondButtonReturn else { return }
                var value=Data(field.stringValue.utf8)
                defer { value.resetBytes(in:0..<value.count) }
                guard MuseKeychainContract.validKey(value) else {
                    self.notice("Key format not accepted", "Use the existing dedicated API key. No credential was saved."); return
                }
                if response == .alertSecondButtonReturn {
                    self.usingSavedKey=false; self.restart(key:String(decoding:value,as:UTF8.self)); return
                }
                do {
                    self.publishConnectionDialog("user-approved-keychain-operation",visible:false)
                    try self.keychainConnection.saveForAutomaticConnection(value,userConfirmed:consent.state == .on)
                    self.usingSavedKey=true; self.restart(key:String(decoding:value,as:UTF8.self))
                } catch MuseKeychainFailure.duplicateItem {
                    self.notice("Named Mulow item already exists", "No existing key was read, replaced or deleted. Use Reconnect Saved Muse Key from the Mulow menu to explicitly allow that named item, or use Session Only.")
                } catch MuseKeychainFailure.consentFile {
                    self.notice("Key saved; automatic access unavailable", "The named item was saved in Keychain, but Mulow could not save its automatic-access consent. No automatic connection was enabled. Use Session Only or resolve the data-folder permissions.")
                } catch {
                    self.notice("Keychain save was not confirmed", "macOS did not confirm saving the named Mulow item. Automatic connection was not enabled. Complete any system prompt yourself or use Session Only.")
                }
            }
            self.publishConnectionDialog("keychain-consent",visible:a.window.isVisible)
        }
    }
    @objc func reconnectSavedMuse() {
        whenIdle {
            let a=NSAlert(); a.messageText="Allow saved Muse key access?"
            a.informativeText="Allow this Mulow application to read only ‘Mulow Muse API Key’ (service: local.mulow.mac.v7.muse; account: dedicated-muse-api-key) from this Mac's Keychain now and automatically on later launches? The key is sent only to Baseten Muse for your requested model calls. No key is shown to Codex. macOS may ask you to approve. Disable this access from the Mulow menu."
            a.addButton(withTitle:"Allow & Connect"); a.addButton(withTitle:"Cancel")
            a.beginSheetModal(for:self.window) { response in
                guard response == .alertFirstButtonReturn else { return }
                do {
                    var value=try self.keychainConnection.reconnectSaved(userConfirmed:true)
                    defer { value.resetBytes(in:0..<value.count) }
                    self.usingSavedKey=true; self.restart(key:String(decoding:value,as:UTF8.self))
                } catch { self.notice("Saved key connection was not confirmed", "The exact named Mulow item could not be read, validated or enabled. No different item was searched. Complete any macOS prompt yourself or use Session Only.") }
            }
        }
    }
    @objc func disableSavedMuse() {
        whenIdle {
            let a=NSAlert(); a.messageText="Disable saved Muse access?"
            a.informativeText="Mulow will stop reading its saved key automatically and disconnect the current session. The named Keychain item stays available for you to manage in Keychain Access. Saved projects remain."
            a.addButton(withTitle:"Disable & Disconnect"); a.addButton(withTitle:"Cancel")
            a.beginSheetModal(for:self.window) { response in
                guard response == .alertFirstButtonReturn else { return }
                do {
                    try self.keychainConnection.disableAutomaticConnection(userConfirmed:true)
                    self.usingSavedKey=false; self.restart(key:"")
                } catch { self.notice("Could not disable automatic access", "The access setting could not be saved. No connection change was made. Check the data-folder permissions.") }
            }
        }
    }
    @objc func disconnectMuse() {
        whenIdle {
            let a=NSAlert(); a.messageText="Disconnect Muse?"; a.informativeText="The workspace reloads and the in-memory session key is discarded. If saved access is enabled, Mulow reconnects on its next launch. Use Disable Saved Muse Access to stop that. Saved projects remain. Save unsent text first."
            a.addButton(withTitle:"Disconnect"); a.addButton(withTitle:"Cancel")
            a.beginSheetModal(for:self.window) { response in if response == .alertFirstButtonReturn {self.usingSavedKey=false;self.restart(key:"")} }
        }
    }
    func restart(key:String) {
        origin=nil; launchGeneration+=1
        if let p=child,p.isRunning {
            p.terminationHandler={_ in DispatchQueue.main.async { self.start(key:key) }}
            p.terminate()
        } else { start(key:key) }
    }
    func start(key:String) {
        launchGeneration+=1; let generation=launchGeneration
        stdoutBuffer=Data(); origin=nil
        web.loadHTMLString("<html><body style='background:#15171a;color:#ddd;font:16px -apple-system;padding:48px'>Starting Mulow…</body></html>",baseURL:nil)
        guard let resources=Bundle.main.resourceURL,let executable=Bundle.main.executableURL else { return }
        do {
            try FileManager.default.createDirectory(at:dataURL,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            let p=Process(), input=Pipe(), output=Pipe(), errors=Pipe()
            p.executableURL=executable.deletingLastPathComponent().appendingPathComponent("node")
            p.arguments=["--use-system-ca",resources.appendingPathComponent("mac/start-mac-session.mjs").path,"--session-pipe-v1",dataURL.path,String(port)]
            p.currentDirectoryURL=resources.appendingPathComponent("runtime")
            let e=ProcessInfo.processInfo.environment
            p.environment=["PATH":"/usr/bin:/bin:/usr/sbin:/sbin","HOME":FileManager.default.homeDirectoryForCurrentUser.path,"TMPDIR":e["TMPDIR"] ?? NSTemporaryDirectory(),"LANG":"en_US.UTF-8"]
            p.standardInput=input; p.standardOutput=output; p.standardError=errors
            output.fileHandleForReading.readabilityHandler={ handle in
                let bytes=handle.availableData
                if bytes.isEmpty {handle.readabilityHandler=nil;return}
                DispatchQueue.main.async {
                    guard self.launchGeneration==generation else {return}
                    self.stdoutBuffer.append(bytes)
                    if self.stdoutBuffer.count>16384 {self.stdoutBuffer.removeAll();return}
                    guard let line=String(data:self.stdoutBuffer,encoding:.utf8)?.components(separatedBy:"\n").first,
                          let data=line.data(using:.utf8),let ready=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],
                          let address=ready["origin"] as? String,let url=URL(string:address),url.host=="127.0.0.1",url.scheme=="http",url.port != nil else {return}
                    self.origin=url; self.stdoutBuffer.removeAll(); self.web.load(URLRequest(url:url))
                    self.window.title=key.isEmpty ? "Mulow · Muse disconnected" : self.usingSavedKey ? "Mulow · Muse configured from approved Keychain item" : "Mulow · Muse key configured for this session"
                }
            }
            errors.fileHandleForReading.readabilityHandler={handle in if handle.availableData.isEmpty {handle.readabilityHandler=nil} }
            p.terminationHandler={process in
                DispatchQueue.main.async {
                    guard !self.quitting,self.launchGeneration==generation else {return}
                    self.origin=nil
                    self.notice("Mulow stopped", "The local service stopped (code \(process.terminationStatus)). The local port may already be in use by another app or Mulow window. No existing service was replaced. Quit and reopen Mulow after resolving the conflict.")
                }
            }
            child=p; try p.run()
            var bytes=Data(key.utf8); var n=UInt32(bytes.count).bigEndian
            var frame=withUnsafeBytes(of:&n){Data($0)}; frame.append(bytes)
            input.fileHandleForWriting.write(frame); try? input.fileHandleForWriting.close()
            bytes.resetBytes(in:0..<bytes.count); frame.resetBytes(in:0..<frame.count)
        } catch { notice("Could not start Mulow", "The bundled local service could not start or the data folder is not writable. No credential was saved.") }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool {true}
    func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply {
        quitting=true
        guard let p=child,p.isRunning else {return .terminateNow}
        p.terminationHandler={_ in DispatchQueue.main.async {NSApp.reply(toApplicationShouldTerminate:true)}}
        p.terminate()
        DispatchQueue.main.asyncAfter(deadline:.now()+7) {if p.isRunning {kill(p.processIdentifier,SIGKILL)};NSApp.reply(toApplicationShouldTerminate:true)}
        return .terminateLater
    }
    func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
        if navigationAction.shouldPerformDownload {decisionHandler(.download);return}
        guard let u=navigationAction.request.url else {decisionHandler(.cancel);return}
        if navigationAction.targetFrame?.isMainFrame==true,let current=origin,u.scheme != "about",u.scheme != "blob",u.scheme != "data",(u.host != current.host || u.port != current.port || u.scheme != current.scheme) {
            if navigationAction.navigationType == .linkActivated, ["https","http"].contains(u.scheme ?? "") {NSWorkspace.shared.open(u)}
            decisionHandler(.cancel);return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for navigationAction:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView? {
        if let url=navigationAction.request.url,["http","https"].contains(url.scheme ?? "") {NSWorkspace.shared.open(url)}
        return nil
    }
    func webView(_ webView:WKWebView,runOpenPanelWith parameters:WKOpenPanelParameters,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping([URL]?)->Void) {
        let p=NSOpenPanel();p.canChooseDirectories=parameters.allowsDirectories;p.canChooseFiles=true;p.allowsMultipleSelection=parameters.allowsMultipleSelection
        p.beginSheetModal(for:window){response in completionHandler(response == .OK ? p.urls:nil)}
    }
    func webView(_ webView:WKWebView,navigationAction:WKNavigationAction,didBecome download:WKDownload) {download.delegate=self}
    func webView(_ webView:WKWebView,navigationResponse:WKNavigationResponse,didBecome download:WKDownload) {download.delegate=self}
    func download(_ download:WKDownload,decideDestinationUsing response:URLResponse,suggestedFilename:String,completionHandler:@escaping(URL?)->Void) {
        let p=NSSavePanel();p.nameFieldStringValue=URL(fileURLWithPath:suggestedFilename).lastPathComponent
        p.beginSheetModal(for:window){r in completionHandler(r == .OK ? p.url:nil)}
    }
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {
        guard !qaWritten,origin != nil,let i=args.firstIndex(of:"--qa-result"),args.count>i+1 else {return}
        let target=args[i+1]
        DispatchQueue.main.asyncAfter(deadline:.now()+2) {
            self.web.callAsyncJavaScript("const s=await (await fetch('/api/status')).json(); const b=[...document.querySelectorAll('button')].map(b=>b.textContent.trim()); return {title:document.title,ready:!!document.querySelector('#app')?.children.length,buttons:b,mode:s.mode,connected:s.connected,limits:s.limits,runs:s.runs.length,executionRuns:s.executionRuns.length,bodyWidth:document.body.scrollWidth,viewportWidth:innerWidth,syntheticPlanVisible:document.body.innerText.includes('Mac Synthetic Plan')};",arguments:[:],in:nil,in:.page) { result in
                switch result {
                case .success(let value):
                    if let value=value as? [String:Any],let data=try? JSONSerialization.data(withJSONObject:value,options:[.prettyPrinted,.sortedKeys]) {try? data.write(to:URL(fileURLWithPath:target),options:.atomic);self.qaWritten=true}
                case .failure(let error): try? Data("WebKit QA failed: \(error.localizedDescription)".utf8).write(to:URL(fileURLWithPath:target))
                }
            }
        }
    }
}

let app=NSApplication.shared
let delegate=MulowDelegate()
app.delegate=delegate
app.setActivationPolicy(.regular)
app.run()
