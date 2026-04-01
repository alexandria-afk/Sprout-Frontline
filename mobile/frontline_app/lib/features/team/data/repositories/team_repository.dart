import 'package:frontline_app/core/api/dio_client.dart';

class TeamRepository {
  /// Get today's shifts (who's scheduled).
  Future<List<Map<String, dynamic>>> getTodayShifts() async {
    final today = DateTime.now().toIso8601String().substring(0, 10);
    final response = await DioClient.instance.get(
      '/api/v1/shifts/',
      queryParameters: {
        'from_date': today,
        'to_date': today,
        'status': 'published',
      },
    );
    final data = response.data;
    if (data is List) return data.cast<Map<String, dynamic>>();
    if (data is Map) {
      final items = data['items'] ?? data['data'];
      if (items is List) return items.cast<Map<String, dynamic>>();
    }
    return [];
  }

  /// Get today's attendance (who's clocked in).
  Future<List<Map<String, dynamic>>> getTodayAttendance() async {
    final today = DateTime.now().toIso8601String().substring(0, 10);
    final response = await DioClient.instance.get(
      '/api/v1/shifts/attendance',
      queryParameters: {
        'from_date': today,
        'to_date': today,
      },
    );
    final data = response.data;
    if (data is List) return data.cast<Map<String, dynamic>>();
    if (data is Map) {
      final items = data['items'] ?? data['data'];
      if (items is List) return items.cast<Map<String, dynamic>>();
    }
    return [];
  }
}
