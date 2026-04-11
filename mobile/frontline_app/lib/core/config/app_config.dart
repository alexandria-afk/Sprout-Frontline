/// App configuration loaded via --dart-define at build time.
/// Never hardcode credentials in source.
///
/// Usage:
///   flutter run \
///     --dart-define=KEYCLOAK_URL=http://10.0.2.2:56144 \
///     --dart-define=KEYCLOAK_REALM=sprout \
///     --dart-define=KEYCLOAK_CLIENT_ID=spaclient \
///     --dart-define=API_BASE_URL=http://10.0.2.2:8000
class AppConfig {
  AppConfig._();

  // Keycloak — passed via --dart-define at build time
  static const keycloakUrl = String.fromEnvironment(
    'KEYCLOAK_URL',
    defaultValue: 'http://10.0.2.2:56144', // Android emulator default
  );
  static const keycloakRealm = String.fromEnvironment(
    'KEYCLOAK_REALM',
    defaultValue: 'sprout',
  );
  static const keycloakClientId = String.fromEnvironment(
    'KEYCLOAK_CLIENT_ID',
    defaultValue: 'spaclient',
  );
  static const redirectUri = 'com.frontliner.app://callback';

  static String get discoveryUrl =>
      '$keycloakUrl/realms/$keycloakRealm/.well-known/openid-configuration';

  // Android emulator → 10.0.2.2 maps to host localhost
  // iOS simulator → localhost works directly
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:8000',
  );
}
