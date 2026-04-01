import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:frontline_app/core/api/dio_client.dart';

/// Injects the Supabase access token into every request.
/// On 401, attempts a token refresh then retries once.
/// If refresh fails, signs the user out.
class AuthInterceptor extends Interceptor {
  bool _isRefreshing = false;

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) {
    final session = Supabase.instance.client.auth.currentSession;
    if (session != null) {
      options.headers['Authorization'] = 'Bearer ${session.accessToken}';
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
        final refreshed =
            await Supabase.instance.client.auth.refreshSession();
        if (refreshed.session != null) {
          // Retry original request with new token
          final opts = err.requestOptions;
          opts.headers['Authorization'] =
              'Bearer ${refreshed.session!.accessToken}';
          // Use the shared DioClient instance (correct baseUrl + options).
          // _isRefreshing is still true here, so no infinite retry.
          final response = await DioClient.instance.fetch(opts);
          handler.resolve(response);
          return;
        }
      } catch (_) {
        // Refresh failed — sign out
        await Supabase.instance.client.auth.signOut();
      } finally {
        _isRefreshing = false;
      }
    }
    handler.next(err);
  }
}
