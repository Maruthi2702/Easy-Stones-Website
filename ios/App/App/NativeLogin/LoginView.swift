import SwiftUI

/// What the login screen shows and edits; owned by RootViewController.
@MainActor
final class LoginModel: ObservableObject {
    @Published var identifier = ""
    @Published var password = ""
    @Published var showPassword = false
    @Published var isWorking = false
    @Published var errorMessage: String?
    @Published var biometryName: String? = CredentialVault.biometryName
    @Published var hasSavedSignIn = CredentialVault.hasSaved

    func refreshVault() {
        biometryName = CredentialVault.biometryName
        hasSavedSignIn = CredentialVault.hasSaved
    }
}

/// The native sign-in screen (design: claude.ai artifact "Mobile Login Screen").
/// Follows the iPhone's Light / Dark setting: dark uses the Nero Marquina slab,
/// light the Calacatta Lincoln, like the website's login page.
struct LoginView: View {
    @ObservedObject var model: LoginModel
    var useFaceID: () -> Void
    var submit: () -> Void
    var forgetSavedSignIn: () -> Void
    @Environment(\.colorScheme) private var scheme
    @FocusState private var focus: Field?
    private enum Field { case identifier, password }

    private var dark: Bool { scheme == .dark }
    private let gold = Color(red: 0.788, green: 0.635, blue: 0.294)           // #C9A24B
    private var goldText: Color { dark ? gold : Color(red: 0.541, green: 0.416, blue: 0.110) }   // #8A6A1C, readable on light
    private var ink: Color { dark ? .white : Color(red: 0.11, green: 0.11, blue: 0.118) }        // #1C1C1E
    private var quiet: Color { dark ? Color(white: 0.56) : Color(white: 0.43) }                  // icons, notes
    private var fieldFill: Color { dark ? Color(red: 0.11, green: 0.11, blue: 0.118) : .white }
    private var fieldEdge: Color { dark ? .clear : Color(white: 0.82) }
    private var errorColor: Color { dark ? Color(red: 1, green: 0.54, blue: 0.5) : Color(red: 0.776, green: 0.157, blue: 0.157) }

    var body: some View {
        ZStack {
            background
            ScrollView {
                VStack(spacing: 0) {
                    header.padding(.top, 96)

                    VStack(spacing: 14) {
                        identifierField
                        passwordField
                    }
                    .padding(.top, 44)

                    if let message = model.errorMessage {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.circle").font(.system(size: 16, weight: .semibold))
                            Text(message).fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                        .font(.system(size: 14))
                        .foregroundColor(errorColor)
                        .padding(.top, 14)
                        .accessibilityElement(children: .combine)
                    }

                    Button(action: submit) {
                        ZStack {
                            if model.isWorking { ProgressView().tint(.black) }
                            else { Text("Sign in").font(.system(size: 17, weight: .semibold)) }
                        }
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(canSubmit || model.isWorking ? gold : gold.opacity(0.4))
                        .foregroundColor(.black)
                        .cornerRadius(12)
                    }
                    .disabled(!canSubmit || model.isWorking)
                    .padding(.top, 22)

                    if let name = model.biometryName, model.hasSavedSignIn {
                        faceIDBlock(name)
                    }

                    Text(footerText)
                        .font(.system(size: 13))
                        .foregroundColor(quiet)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 36)
                        .padding(.bottom, 32)
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboardIfAvailable()
        }
    }

    // MARK: Pieces

    private var background: some View {
        ZStack {
            (dark ? Color.black : Color(white: 0.96))
            Image(dark ? "LoginSlabDark" : "LoginSlabLight")
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
            LinearGradient(
                stops: dark
                ? [.init(color: .black.opacity(0.30), location: 0), .init(color: .black.opacity(0.62), location: 0.45), .init(color: .black.opacity(0.82), location: 1)]
                : [.init(color: .white.opacity(0.35), location: 0), .init(color: .white.opacity(0.72), location: 0.45), .init(color: .white.opacity(0.90), location: 1)],
                startPoint: .top, endPoint: .bottom)
        }
        .ignoresSafeArea()
    }

    private var header: some View {
        VStack(spacing: 14) {
            Image("LoginMark")
                .resizable().scaledToFit()
                .frame(width: 40, height: 52)
                .accessibilityHidden(true)
            Text("EASY SURFACES")
                .font(.system(size: 24, weight: .semibold))
                .tracking(4)
                .foregroundColor(ink)
                .accessibilityAddTraits(.isHeader)
        }
    }

    private var identifierField: some View {
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
    }

    private var passwordField: some View {
        field(icon: "lock", invalid: model.errorMessage != nil) {
            Group {
                if model.showPassword { TextField("Password", text: $model.password) }
                else { SecureField("Password", text: $model.password) }
            }
            .textContentType(.password)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled(true)
            .submitLabel(.go)
            .focused($focus, equals: .password)
            .onSubmit(submit)
            Button { model.showPassword.toggle() } label: {
                Image(systemName: model.showPassword ? "eye.slash" : "eye")
                    .foregroundColor(quiet)
                    .frame(width: 44, height: 44)
            }
            .padding(.trailing, -10)
            .accessibilityLabel(model.showPassword ? "Hide password" : "Show password")
        }
    }

    private func faceIDBlock(_ name: String) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Rectangle().fill(quiet.opacity(0.35)).frame(height: 1)
                Text("or").font(.system(size: 13)).foregroundColor(quiet)
                Rectangle().fill(quiet.opacity(0.35)).frame(height: 1)
            }
            .padding(.top, 28)
            .accessibilityHidden(true)

            Button(action: useFaceID) {
                Label("Sign in with \(name)", systemImage: name == "Face ID" ? "faceid" : "touchid")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(gold, lineWidth: 1.5))
                    .foregroundColor(goldText)
            }
            .disabled(model.isWorking)
            .padding(.top, 22)

            Button("Use a different account", action: forgetSavedSignIn)
                .font(.system(size: 14))
                .foregroundColor(quiet)
                .frame(minHeight: 44)
                .padding(.top, 6)
        }
    }

    private var footerText: String {
        if model.errorMessage != nil { return "Five wrong passwords lock the account for 15 minutes." }
        if model.hasSavedSignIn, model.biometryName != nil {
            return "\(model.biometryName ?? "Face ID") unlocks the sign-in saved on this iPhone. It never leaves the device."
        }
        return "Forgot your password? Ask your manager to reset it in Users & Roles."
    }

    private var canSubmit: Bool {
        !model.identifier.trimmingCharacters(in: .whitespaces).isEmpty && !model.password.isEmpty
    }

    private func field<Content: View>(icon: String, invalid: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .foregroundColor(invalid ? errorColor : quiet)
                .frame(width: 22)
                .accessibilityHidden(true)
            content()
        }
        .font(.system(size: 17))          // 16pt+ so iOS doesn't zoom
        .foregroundColor(ink)
        .padding(.horizontal, 14)
        .frame(minHeight: 52)
        .background(fieldFill)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(invalid ? errorColor : fieldEdge, lineWidth: invalid ? 1.5 : 1))
    }
}

private extension View {
    @ViewBuilder func scrollDismissesKeyboardIfAvailable() -> some View {
        if #available(iOS 16.0, *) { self.scrollDismissesKeyboard(.interactively) } else { self }
    }
}
