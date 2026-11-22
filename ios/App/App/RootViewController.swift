import UIKit
import SwiftUI
import WebKit
import Capacitor

/// The app's first screen: the website (Capacitor's web view) underneath, and
/// a native sign-in screen on top of it whenever nobody is signed in.
///
///  - On launch: if the web view's cookies still sign someone in, the sign-in
///    screen never shows. Otherwise it shows, and Face ID is offered first.
///  - A sign-in (typed, or Face ID) is made natively; its cookies are handed to
///    the web view, which then opens /sales.
///  - Signing out in the web app (or an expired session) lands the web view on
///    /login — that brings the native screen back instead of the web page.
final class RootViewController: UIViewController {
    private let bridgeController = CAPBridgeViewController()
    private let service = SignInService(baseURL: SignInService.configuredBaseURL())
    private let model = LoginModel()
    private var loginHost: UIHostingController<LoginView>?
    private var urlObservation: NSKeyValueObservation?
    private var checkedSession = false

    private var webView: WKWebView? { bridgeController.bridge?.webView }
    private var cookieStore: WKHTTPCookieStore { (webView?.configuration.websiteDataStore ?? WKWebsiteDataStore.default()).httpCookieStore }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        addChild(bridgeController)
        bridgeController.view.frame = view.bounds
        bridgeController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(bridgeController.view)
        bridgeController.didMove(toParent: self)

        // Cover the web view at once, so the site never flashes before the check.
        showLogin(offerFaceIDNow: false, signedOutRightNow: false)
        loginHost?.view.alpha = 0
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !checkedSession else { return }
        checkedSession = true
        Task { await launchCheck() }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: Launch

    private func launchCheck() async {
        if await service.hasValidSession(cookieStore: cookieStore) {
            hideLogin()
        } else {
            await MainActor.run { loginHost?.view.alpha = 1 }
            if CredentialVault.hasSaved { await signInWithFaceID() }
        }
        observeWebAddress()
    }

    /// The web app's own sign-out / expired session ends up on /login.
    private func observeWebAddress() {
        guard let webView else { return }
        urlObservation = webView.observe(\.url, options: [.new]) { [weak self] _, change in
            guard let url = change.newValue ?? nil, let self else { return }
            let path = url.path.lowercased()
            guard path == "/login" || path == "/login/" || path == "/admin/login" else { return }
            DispatchQueue.main.async {
                guard self.loginHost == nil else { return }
                self.showLogin(offerFaceIDNow: false, signedOutRightNow: true)
            }
        }
    }

    // MARK: The overlay

    private func showLogin(offerFaceIDNow: Bool, signedOutRightNow: Bool) {
        guard loginHost == nil else { return }
        model.refreshVault()
        model.errorMessage = nil
        model.password = ""
        let host = UIHostingController(rootView: LoginView(
            model: model,
            useFaceID: { [weak self] in Task { await self?.signInWithFaceID() } },
            submit: { [weak self] in Task { await self?.signInTyped() } },
            forgetSavedSignIn: { [weak self] in
                CredentialVault.clear()
                self?.model.refreshVault()
            }))
        host.view.backgroundColor = .black
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        loginHost = host
    }

    private func hideLogin() {
        DispatchQueue.main.async {
            guard let host = self.loginHost else { return }
            UIView.animate(withDuration: 0.2, animations: { host.view.alpha = 0 }, completion: { _ in
                host.willMove(toParent: nil)
                host.view.removeFromSuperview()
                host.removeFromParent()
                self.loginHost = nil
                self.model.password = ""
            })
        }
    }

    // MARK: Signing in

    @MainActor
    private func signInTyped() async {
        let identifier = model.identifier.trimmingCharacters(in: .whitespaces)
        let password = model.password
        guard !identifier.isEmpty, !password.isEmpty, !model.isWorking else { return }
        view.endEditing(true)
        let outcome = await attempt(identifier: identifier, password: password)
        if outcome == .success { await offerToSave(identifier: identifier, password: password) }
        if outcome == .success { open() }
    }

    @MainActor
    private func signInWithFaceID() async {
        guard !model.isWorking, let name = CredentialVault.biometryName else { return }
        guard let saved = await CredentialVault.load(reason: "Sign in to Easy Surfaces with \(name)") else { return }
        let outcome = await attempt(identifier: saved.identifier, password: saved.password, fromSaved: true)
        if outcome == .success { open() }
    }

    private enum Outcome { case success, failed }

    /// One attempt: shows progress and the server's own words on a refusal.
    @MainActor
    private func attempt(identifier: String, password: String, fromSaved: Bool = false) async -> Outcome {
        model.isWorking = true
        model.errorMessage = nil
        defer { model.isWorking = false }
        switch await service.signIn(identifier: identifier, password: password, cookieStore: cookieStore) {
        case .signedIn, .needsPasswordSetup:
            return .success                      // a setup session is opened the same way; the site asks for the new password
        case .refused(let message, let wrongPassword):
            if fromSaved && wrongPassword {
                // The password changed since Face ID was turned on.
                CredentialVault.clear()
                model.refreshVault()
                model.errorMessage = "Your saved sign-in is out of date. Sign in with your password to set up Face ID again."
            } else {
                model.errorMessage = message
            }
            return .failed
        case .offline:
            model.errorMessage = "Couldn't reach the server. Check your connection and try again."
            return .failed
        }
    }

    /// After a first typed sign-in, ask once whether to use Face ID next time.
    @MainActor
    private func offerToSave(identifier: String, password: String) async {
        guard let name = CredentialVault.biometryName else { return }
        let alreadySame = CredentialVault.hasSaved
        if alreadySame { CredentialVault.save(identifier: identifier, password: password); return }   // keep it current
        let allow: Bool = await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: "Use \(name) next time?",
                                          message: "Sign in faster without typing your password. You can turn it off any time with “Use a different account”.",
                                          preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Not now", style: .cancel) { _ in continuation.resume(returning: false) })
            alert.addAction(UIAlertAction(title: "Use \(name)", style: .default) { _ in continuation.resume(returning: true) })
            present(alert, animated: true)
        }
        if allow { CredentialVault.save(identifier: identifier, password: password) }
    }

    /// Signed in: open the site on its home screen and drop the overlay.
    @MainActor
    private func open() {
        if let webView {
            webView.load(URLRequest(url: service.baseURL.appendingPathComponent("sales")))
        }
        // Give the page a moment so the sign-in screen doesn't reveal a blank web view.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.hideLogin() }
    }
}
