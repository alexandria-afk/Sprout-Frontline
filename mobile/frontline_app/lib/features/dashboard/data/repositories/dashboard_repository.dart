import 'package:dio/dio.dart';
import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/dashboard/data/models/dashboard_summary.dart';

class DashboardRepository {
  Future<DashboardSummary> getSummary() async {
    try {
      final response =
          await DioClient.instance.get('/api/v1/dashboard/summary');
      final data = response.data;
      if (data is Map<String, dynamic>) {
        return DashboardSummary.fromJson(data);
      }
    } on DioException catch (e) {
      // Staff role gets 403 — return empty summary instead of crashing.
      if (e.response?.statusCode == 403) {
        return DashboardSummary.empty();
      }
      rethrow;
    }
    return DashboardSummary.empty();
  }
}
