/// App configuration loaded via --dart-define at build time.
/// Never hardcode credentials in source.
///
/// Usage:
///   flutter run \
///     --dart-define=SUPABASE_URL=https://xxx.supabase.co \
///     --dart-define=SUPABASE_ANON_KEY=eyJxx \
///     --dart-define=API_BASE_URL=http://localhost:8000
class AppConfig {
  AppConfig._();

  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

  // Android emulator → 10.0.2.2 maps to host localhost
  // iOS simulator → localhost works directly
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:8000',
  );
}
