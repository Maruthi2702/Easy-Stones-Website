import Foundation
import LocalAuthentication
import Security

/// The saved sign-in behind Face ID. The password sits in the Keychain behind
/// biometry (`.biometryCurrentSet`): reading it is what shows the Face ID
/// prompt, and enrolling a new face makes iOS discard it, so the person types
/// the password once more. Only this device, only with a passcode set.
enum CredentialVault {
    struct Credentials {
        let identifier: String
        let password: String
    }

    private static let service = "app.easysurfaces.sign-in"

    /// "Face ID", "Touch ID", or nil when this phone can't use biometry at all.
    static var biometryName: String? {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else { return nil }
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        default: return nil
        }
    }

    /// Whether a sign-in is saved. This must never show the Face ID prompt (it runs at
    /// launch and whenever the sign-in screen appears), so the lookup is told no
    /// interaction is allowed: iOS then answers "found, but needs Face ID" instead of asking.
    static var hasSaved: Bool {
        let context = LAContext()
        context.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecUseAuthenticationContext as String: context,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    @discardableResult
    static func save(identifier: String, password: String) -> Bool {
        clear()
        guard biometryName != nil,
              let access = SecAccessControlCreateWithFlags(
                nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, nil)
        else { return false }
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: identifier,
            kSecValueData as String: Data(password.utf8),
            kSecAttrAccessControl as String: access,
        ]
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    /// Shows the Face ID prompt and returns the saved sign-in, or nil when the
    /// person cancels, fails, or nothing is saved.
    static func load(reason: String) async -> Credentials? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let context = LAContext()
                context.localizedReason = reason
                let query: [String: Any] = [
                    kSecClass as String: kSecClassGenericPassword,
                    kSecAttrService as String: service,
                    kSecReturnData as String: true,
                    kSecReturnAttributes as String: true,
                    kSecUseAuthenticationContext as String: context,
                ]
                var result: CFTypeRef?
                guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
                      let found = result as? [String: Any],
                      let account = found[kSecAttrAccount as String] as? String,
                      let data = found[kSecValueData as String] as? Data,
                      let password = String(data: data, encoding: .utf8)
                else { return continuation.resume(returning: nil) }
                continuation.resume(returning: Credentials(identifier: account, password: password))
            }
        }
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
