import Foundation
import Security
import LocalAuthentication

enum MuseKeychainContract {
    static let service = "local.mulow.mac.v7.muse"
    static let account = "dedicated-muse-api-key"
    static let label = "Mulow Muse API Key"
    static let markerName = "muse-keychain-consent-v1.json"
    static func validKey(_ value: Data) -> Bool {
        (16...1000).contains(value.count) && value.allSatisfy { (33...126).contains($0) }
    }
}

enum MuseKeychainFailure: Error {
    case confirmationRequired, invalidKey, duplicateItem, unavailable(OSStatus), consentFile
}

protocol MuseKeychainBackend {
    func add(_ value: Data) throws
    func load() throws -> Data
}

// No enumeration, fallback service, existing-item update, shell, or key export.
struct NativeMuseKeychain: MuseKeychainBackend {
    let applicationPath: String
    private var identity: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: MuseKeychainContract.service,
         kSecAttrAccount as String: MuseKeychainContract.account,
         kSecAttrSynchronizable as String: false]
    }
    func add(_ value: Data) throws {
        var trusted: SecTrustedApplication?
        let trustedStatus = SecTrustedApplicationCreateFromPath(applicationPath, &trusted)
        guard trustedStatus == errSecSuccess, let trusted else {
            throw MuseKeychainFailure.unavailable(trustedStatus)
        }
        var access: SecAccess?
        let accessStatus = SecAccessCreate(MuseKeychainContract.label as CFString, [trusted] as CFArray, &access)
        guard accessStatus == errSecSuccess, let access else {
            throw MuseKeychainFailure.unavailable(accessStatus)
        }
        var query = identity
        query[kSecAttrLabel as String] = MuseKeychainContract.label
        query[kSecAttrAccess as String] = access
        query[kSecValueData as String] = value
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem { throw MuseKeychainFailure.duplicateItem }
        guard status == errSecSuccess else { throw MuseKeychainFailure.unavailable(status) }
    }
    func load() throws -> Data {
        var query = identity
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        let context=LAContext(); context.interactionNotAllowed=false
        query[kSecUseAuthenticationContext as String] = context
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        guard status == errSecSuccess, let data = value as? Data else {
            throw MuseKeychainFailure.unavailable(status)
        }
        return data
    }
}

struct MuseKeychainConsent: Codable {
    let version: Int
    let service: String
    let account: String
    let scope: String
    let automaticConnection: Bool
    let confirmedAt: String
    static func explicit(enabled: Bool) -> Self {
        Self(version: 1, service: MuseKeychainContract.service, account: MuseKeychainContract.account,
             scope: "explicit-local-user-save-and-automatic-mulow-access", automaticConnection: enabled,
             confirmedAt: ISO8601DateFormatter().string(from: Date()))
    }
    var permitsAutomaticConnection: Bool {
        version == 1 && service == MuseKeychainContract.service && account == MuseKeychainContract.account &&
        scope == "explicit-local-user-save-and-automatic-mulow-access" && automaticConnection &&
        ISO8601DateFormatter().date(from: confirmedAt) != nil
    }
}

protocol MuseConsentStorage {
    func read() -> MuseKeychainConsent?
    func write(_ consent: MuseKeychainConsent) throws
}

struct FileMuseConsent: MuseConsentStorage {
    let directory: URL
    private var file: URL { directory.appendingPathComponent(MuseKeychainContract.markerName) }
    func read() -> MuseKeychainConsent? {
        guard let data = try? Data(contentsOf: file), data.count <= 2048 else { return nil }
        return try? JSONDecoder().decode(MuseKeychainConsent.self, from: data)
    }
    func write(_ consent: MuseKeychainConsent) throws {
        try JSONEncoder().encode(consent).write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}

final class MuseKeychainConnection {
    let backend: MuseKeychainBackend
    let consent: MuseConsentStorage
    init(backend: MuseKeychainBackend, consent: MuseConsentStorage) {
        self.backend = backend; self.consent = consent
    }
    var allowsAutomaticConnection: Bool { consent.read()?.permitsAutomaticConnection == true }
    func saveForAutomaticConnection(_ value: Data, userConfirmed: Bool) throws {
        guard userConfirmed else { throw MuseKeychainFailure.confirmationRequired }
        guard MuseKeychainContract.validKey(value) else { throw MuseKeychainFailure.invalidKey }
        try backend.add(value)
        do { try consent.write(.explicit(enabled: true)) }
        catch { throw MuseKeychainFailure.consentFile }
    }
    func loadAutomatically() throws -> Data? {
        guard allowsAutomaticConnection else { return nil }
        let value = try backend.load()
        guard MuseKeychainContract.validKey(value) else { throw MuseKeychainFailure.invalidKey }
        return value
    }
    func reconnectSaved(userConfirmed: Bool) throws -> Data {
        guard userConfirmed else { throw MuseKeychainFailure.confirmationRequired }
        let value = try backend.load()
        guard MuseKeychainContract.validKey(value) else { throw MuseKeychainFailure.invalidKey }
        do { try consent.write(.explicit(enabled: true)) }
        catch { throw MuseKeychainFailure.consentFile }
        return value
    }
    func disableAutomaticConnection(userConfirmed: Bool) throws {
        guard userConfirmed else { throw MuseKeychainFailure.confirmationRequired }
        try consent.write(.explicit(enabled: false))
    }
}
