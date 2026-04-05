import 'package:dio/dio.dart';
import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/dashboard/data/models/dashboard_summary.dart';

class DashboardRepository {
  /// Today's summary (checklist completion, attendance).
  Future<DashboardSummary> getSummary() async {
    try {
      final today = DateTime.now().toIso8601String().substring(0, 10);
      final response = await DioClient.instance.get(
        '/api/v1/dashboard/summary',
        queryParameters: {'from': today, 'to': today},
      );
      final data = response.data;
      if (data is Map<String, dynamic>) {
        return DashboardSummary.fromJson(data);
      }
    } on DioException catch (e) {
      if (e.response?.statusCode == 403) {
        return DashboardSummary.empty();
      }
      rethrow;
    }
    return DashboardSummary.empty();
  }

  /// Rolling 30-day summary (audit compliance rate).
  Future<double?> getAuditComplianceRate() async {
    try {
      final now = DateTime.now();
      final thirtyDaysAgo =
          now.subtract(const Duration(days: 30)).toIso8601String().substring(0, 10);
      final response = await DioClient.instance.get(
        '/api/v1/dashboard/summary',
        queryParameters: {'from': thirtyDaysAgo},
      );
      final data = response.data;
      if (data is Map) {
        final rate = data['audit_compliance_rate'] as num?;
        return rate != null ? (rate * 100).toDouble() : null;
      }
    } catch (_) {}
    return null;
  }

  /// Training completion rate from LMS analytics.
  Future<double?> getTrainingCompletionRate() async {
    try {
      final response = await DioClient.instance
          .get('/api/v1/lms/analytics/completion');
      final data = response.data;
      if (data is Map) {
        return (data['completion_rate'] as num?)?.toDouble();
      }
    } catch (_) {}
    return null;
  }

  /// Count of published shifts today (org-wide for manager/admin).
  Future<int?> getShiftsTodayCount() async {
    try {
      final today = DateTime.now().toIso8601String().substring(0, 10);
      final response = await DioClient.instance.get(
        '/api/v1/shifts/',
        queryParameters: {
          'from_date': '${today}T00:00:00',
          'to_date': '${today}T23:59:59',
          'status': 'published',
          'page_size': 1,
        },
      );
      final data = response.data;
      if (data is Map) {
        return (data['total_count'] as int?) ?? 0;
      }
    } catch (_) {}
    return null;
  }
}
