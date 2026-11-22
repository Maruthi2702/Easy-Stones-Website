import SwiftUI

/// What the login screen needs from whoever owns it.
@MainActor
final class LoginModel: ObservableObject {
    @Published var identifier = ""
    @Published var password = ""
    @Published var showPassword = false
    @Published var isWorking = false
    @Published var errorMessage: String?
    @Published var offerFaceID = false          // the "Turn on Face ID?" question after a first sign-in
    @Published var biometryName: String? = CredentialVault.biometryName
    @Published var hasSavedSignIn = CredentialVault.hasSaved

    func refreshVault() {
        biometryName = CredentialVault.biometryName
        hasSavedSignIn = CredentialVault.hasSaved
    }
}

struct LoginView: View {
    @ObservedObject var model: LoginModel
    var useFaceID: () -> Void
    var submit: () -> Void
    var forgetSavedSignIn: () -> Void
    @FocusState private var focus: Field?
    private enum Field { case identifier, password }

    private let gold = Color(red: 0.79, green: 0.64, blue: 0.29)

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 24) {
                    VStack(spacing: 6) {
                        Text("EASY SURFACES")
                            .font(.system(size: 26, weight: .semibold))
                            .tracking(3)
                            .foregroundColor(.white)
                        Text("Sign in to continue")
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.6))
                    }
                    .padding(.top, 72)

                    VStack(spacing: 14) {
                        field(icon: "person") {
                            TextField("Email or username", text: $model.identifier)
                                .textContentType(.username)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled(true)
                                .submitLabel(.next)
                                .focused($focus, equals: .identifier)
                                .onSubmit { focus = .password }
                        }
                        field(icon: "lock") {
                            Group {
                                if model.showPassword {
                                    TextField("Password", text: $model.password)
                                } else {
                                    SecureField("Password", text: $model.password)
                                }
                            }
                            .textContentType(.password)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled(true)
                            .submitLabel(.go)
                            .focused($focus, equals: .password)
                            .onSubmit(submit)
                            Button { model.showPassword.toggle() } label: {
                                Image(systemName: model.showPassword ? "eye.slash" : "eye")
                                    .foregroundColor(.white.opacity(0.6))
                            }
                            .accessibilityLabel(model.showPassword ? "Hide password" : "Show password")
                        }
                    }

                    if let message = model.errorMessage {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.circle.fill")
                            Text(message).fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                        .font(.footnote)
                        .foregroundColor(Color(red: 1, green: 0.45, blue: 0.4))
                        .accessibilityElement(children: .combine)
                    }

                    Button(action: submit) {
                        ZStack {
                            if model.isWorking { ProgressView().tint(.black) }
                            else { Text("Sign in").font(.headline) }
                        }
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(canSubmit ? gold : gold.opacity(0.4))
                        .foregroundColor(.black)
                        .cornerRadius(12)
                    }
                    .disabled(!canSubmit || model.isWorking)

                    if let name = model.biometryName, model.hasSavedSignIn {
                        VStack(spacing: 10) {
                            Button(action: useFaceID) {
                                Label("Sign in with \(name)", systemImage: name == "Face ID" ? "faceid" : "touchid")
                                    .frame(maxWidth: .infinity, minHeight: 50)
                                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(gold, lineWidth: 1.5))
                                    .foregroundColor(gold)
                            }
                            .disabled(model.isWorking)
                            Button("Use a different account", action: forgetSavedSignIn)
                                .font(.footnote)
                                .foregroundColor(.white.opacity(0.6))
                        }
                    }
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboardIfAvailable()
        }
        .preferredColorScheme(.dark)
    }

    private var canSubmit: Bool {
        !model.identifier.trimmingCharacters(in: .whitespaces).isEmpty && !model.password.isEmpty
    }

    private func field<Content: View>(icon: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundColor(.white.opacity(0.5)).frame(width: 22)
            content()
        }
        .font(.system(size: 17))          // 16pt+ so iOS doesn't zoom
        .foregroundColor(.white)
        .padding(.horizontal, 14)
        .frame(minHeight: 50)
        .background(Color.white.opacity(0.09))
        .cornerRadius(12)
    }
}

private extension View {
    @ViewBuilder func scrollDismissesKeyboardIfAvailable() -> some View {
        if #available(iOS 16.0, *) { self.scrollDismissesKeyboard(.interactively) } else { self }
    }
}
