import 'package:dio/dio.dart';
import 'package:frontline_app/core/auth/auth_repository.dart';
import 'package:frontline_app/core/api/dio_client.dart';

/// Injects the Keycloak access token into every request.
/// On 401, attempts a token refresh then retries once.
/// If refresh fails, clears stored tokens.
class AuthInterceptor extends Interceptor {
  final AuthRepository _repo = AuthRepository();
  bool _isRefreshing = false;

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await _repo.getAccessToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    if (err.response?.statusCode == 401 && !_isRefreshing) {
      _isRefreshing = true;
      try {
        final newToken = await _repo.refreshAccessToken();
        if (newToken != null) {
          final opts = err.requestOptions;
          opts.headers['Authorization'] = 'Bearer $newToken';
          // Use the shared DioClient instance (correct baseUrl + options).
          // _isRefreshing is still true here, so no infinite retry.
          final response = await DioClient.instance.fetch(opts);
          handler.resolve(response);
          return;
        }
      } finally {
        _isRefreshing = false;
      }
    }
    handler.next(err);
  }
}
