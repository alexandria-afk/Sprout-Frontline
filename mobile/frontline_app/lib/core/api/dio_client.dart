import 'package:dio/dio.dart';
import 'package:frontline_app/core/api/auth_interceptor.dart';
import 'package:frontline_app/core/config/app_config.dart';

/// Singleton Dio instance used by all API repositories.
/// Interceptors: auth token injection + 401 refresh + retry.
class DioClient {
  DioClient._();

  static Dio? _instance;

  static Dio get instance {
    _instance ??= _buildDio();
    return _instance!;
  }

  static Dio _buildDio() {
    final dio = Dio(
      BaseOptions(
        baseUrl: AppConfig.apiBaseUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 15),
        headers: {'Content-Type': 'application/json'},
      ),
    );
    dio.interceptors.add(AuthInterceptor());
    return dio;
  }
}
