import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/shifts/data/models/shift_models.dart';

class ShiftsRepository {
  /// Fetch current user's published shifts.
  Future<List<Shift>> getMyShifts() async {
    final response = await DioClient.instance.get('/api/v1/shifts/my');
    return _unwrapList(response.data).map(Shift.fromJson).toList();
  }

  /// Fetch open shifts available to claim.
  Future<List<Shift>> getOpenShifts() async {
    final response = await DioClient.instance.get('/api/v1/shifts/open');
    return _unwrapList(response.data).map(Shift.fromJson).toList();
  }

  /// Clock in to a shift.
  Future<AttendanceRecord> clockIn({
    String? shiftId,
    required String locationId,
    required double latitude,
    required double longitude,
  }) async {
    final response = await DioClient.instance.post(
      '/api/v1/shifts/attendance/clock-in',
      data: {
        if (shiftId != null) 'shift_id': shiftId, // ignore: use_null_aware_elements
        'location_id': locationId,
        'clock_in_method': 'gps',
        'latitude': latitude,
        'longitude': longitude,
      },
    );
    return AttendanceRecord.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }

  /// Clock out from an attendance record.
  Future<AttendanceRecord> clockOut({
    required String attendanceId,
    double? latitude,
    double? longitude,
  }) async {
    final response = await DioClient.instance.post(
      '/api/v1/shifts/attendance/clock-out',
      data: {
        'attendance_id': attendanceId,
        if (latitude != null) 'latitude': latitude, // ignore: use_null_aware_elements
        if (longitude != null) 'longitude': longitude, // ignore: use_null_aware_elements
      },
    );
    return AttendanceRecord.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }

  /// Claim an open shift.
  Future<ShiftClaim> claimShift(String shiftId) async {
    final response = await DioClient.instance
        .post('/api/v1/shifts/$shiftId/claim');
    return ShiftClaim.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }
}

List<Map<String, dynamic>> _unwrapList(dynamic data) {
  if (data is List) return data.cast<Map<String, dynamic>>();
  if (data is Map) {
    final items = data['items'] ?? data['data'];
    if (items is List) return items.cast<Map<String, dynamic>>();
  }
  return [];
}
