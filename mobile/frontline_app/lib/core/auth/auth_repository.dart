import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:jwt_decoder/jwt_decoder.dart';
import 'package:frontline_app/core/config/app_config.dart';

const _kAccessToken = 'kc_access_token';
const _kRefreshToken = 'kc_refresh_token';
const _kIdToken = 'kc_id_token';

class AuthRepository {
  final FlutterAppAuth _appAuth = const FlutterAppAuth();
  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  /// Login — launches browser via PKCE flow
  Future<void> signIn() async {
    final result = await _appAuth.authorizeAndExchangeCode(
      AuthorizationTokenRequest(
        AppConfig.keycloakClientId,
        AppConfig.redirectUri,
        discoveryUrl: AppConfig.discoveryUrl,
        scopes: ['openid', 'profile', 'email'],
        preferEphemeralSession: false,
      ),
    );
    if (result == null) throw Exception('Login cancelled');
    await _saveTokens(result.accessToken, result.refreshToken, result.idToken);
  }

  Future<void> signOut() async {
    final idToken = await _storage.read(key: _kIdToken);
    try {
      await _appAuth.endSession(
        EndSessionRequest(
          idTokenHint: idToken,
          postLogoutRedirectUrl: AppConfig.redirectUri,
          discoveryUrl: AppConfig.discoveryUrl,
        ),
      );
    } catch (_) {}
    await _storage.deleteAll();
  }

  Future<String?> getAccessToken() => _storage.read(key: _kAccessToken);

  Future<String?> refreshAccessToken() async {
    final refreshToken = await _storage.read(key: _kRefreshToken);
    if (refreshToken == null) return null;
    try {
      final result = await _appAuth.token(
        TokenRequest(
          AppConfig.keycloakClientId,
          AppConfig.redirectUri,
          discoveryUrl: AppConfig.discoveryUrl,
          refreshToken: refreshToken,
          grantType: GrantType.refreshToken,
          scopes: ['openid', 'profile', 'email'],
        ),
      );
      if (result == null) return null;
      await _saveTokens(result.accessToken, result.refreshToken, result.idToken);
      return result.accessToken;
    } catch (_) {
      await _storage.deleteAll();
      return null;
    }
  }

  Future<Map<String, dynamic>?> getCurrentUserClaims() async {
    final token = await getAccessToken();
    if (token == null) return null;
    if (JwtDecoder.isExpired(token)) {
      final refreshed = await refreshAccessToken();
      if (refreshed == null) return null;
      return JwtDecoder.decode(refreshed);
    }
    return JwtDecoder.decode(token);
  }

  Future<String?> getCurrentUserId() async {
    final claims = await getCurrentUserClaims();
    return claims?['sub'] as String?;
  }

  Future<bool> isSignedIn() async {
    final token = await getAccessToken();
    if (token == null) return false;
    if (!JwtDecoder.isExpired(token)) return true;
    final refreshed = await refreshAccessToken();
    return refreshed != null;
  }

  Future<void> _saveTokens(String? access, String? refresh, String? id) async {
    if (access != null) await _storage.write(key: _kAccessToken, value: access);
    if (refresh != null) await _storage.write(key: _kRefreshToken, value: refresh);
    if (id != null) await _storage.write(key: _kIdToken, value: id);
  }
}
