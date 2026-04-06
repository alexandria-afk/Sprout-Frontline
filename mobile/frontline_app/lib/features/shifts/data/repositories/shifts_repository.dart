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

  /// Fetch the active attendance record (status=present) for the current user.
  Future<AttendanceRecord?> getActiveAttendance() async {
    final response = await DioClient.instance.get(
      '/api/v1/shifts/attendance',
      queryParameters: {'status': 'present'},
    );
    final data = response.data;
    List? raw;
    if (data is Map) {
      final items = data['items'] ?? data['data'];
      if (items is List) raw = items;
    } else if (data is List) {
      raw = data;
    }
    if (raw == null || raw.isEmpty) return null;
    return AttendanceRecord.fromJson(Map<String, dynamic>.from(raw.first as Map));
  }

  /// Claim an open shift.
  Future<ShiftClaim> claimShift(String shiftId) async {
    final response = await DioClient.instance
        .post('/api/v1/shifts/$shiftId/claim');
    return ShiftClaim.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }

  /// Start a break within an active attendance session.
  Future<BreakRecord> startBreak({
    required String attendanceId,
    required String breakType,
  }) async {
    final response = await DioClient.instance.post(
      '/api/v1/shifts/attendance/break/start',
      data: {
        'attendance_id': attendanceId,
        'break_type': breakType,
      },
    );
    return BreakRecord.fromJson(Map<String, dynamic>.from(response.data as Map));
  }

  /// End the current active break.
  Future<BreakRecord> endBreak({required String attendanceId}) async {
    final response = await DioClient.instance.post(
      '/api/v1/shifts/attendance/break/end',
      data: {'attendance_id': attendanceId},
    );
    return BreakRecord.fromJson(Map<String, dynamic>.from(response.data as Map));
  }

  /// Get break status for an attendance session.
  Future<BreakStatus> getBreakStatus({required String attendanceId}) async {
    final response = await DioClient.instance.get(
      '/api/v1/shifts/attendance/break/status',
      queryParameters: {'attendance_id': attendanceId},
    );
    return BreakStatus.fromJson(Map<String, dynamic>.from(response.data as Map));
  }

  // ── Swap requests ──────────────────────────────────────────
  Future<List<ShiftSwapRequest>> getSwapRequests() async {
    final response = await DioClient.instance.get('/api/v1/shifts/swaps');
    final data = response.data;
    List? raw;
    if (data is List) {
      raw = data;
    } else if (data is Map) {
      raw = (data['items'] ?? data['data']) as List?;
    }
    if (raw == null) return [];
    return raw
        .map((e) =>
            ShiftSwapRequest.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<ShiftSwapRequest> createSwapRequest({required String shiftId}) async {
    final response = await DioClient.instance.post(
      '/api/v1/shifts/swaps',
      data: {'shift_id': shiftId},
    );
    return ShiftSwapRequest.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }

  Future<void> cancelSwap({required String swapId}) async {
    await DioClient.instance.post('/api/v1/shifts/swaps/$swapId/cancel');
  }

  /// Colleague accepts or declines an incoming swap request.
  Future<void> respondToSwapAsColleague({
    required String swapId,
    required String action, // 'accept' or 'decline'
  }) async {
    await DioClient.instance.put(
      '/api/v1/shifts/swaps/$swapId/colleague-response',
      data: {'action': action},
    );
  }

  // ── Leave requests ─────────────────────────────────────────
  Future<List<LeaveRequest>> getLeaveRequests() async {
    final response = await DioClient.instance.get('/api/v1/shifts/leave');
    final data = response.data;
    List? raw;
    if (data is Map) {
      raw = (data['items'] ?? data['data']) as List?;
    } else if (data is List) {
      raw = data;
    }
    if (raw == null) return [];
    return raw
        .map((e) => LeaveRequest.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<LeaveRequest> createLeaveRequest({
    required String leaveType,
    required String startDate,
    required String endDate,
    String? reason,
  }) async {
    final response = await DioClient.instance.post(
      '/api/v1/shifts/leave',
      data: {
        'leave_type': leaveType,
        'start_date': startDate,
        'end_date': endDate,
        if (reason != null && reason.isNotEmpty) 'reason': reason, // ignore: use_null_aware_elements
      },
    );
    return LeaveRequest.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }
}

List<Map<String, dynamic>> _unwrapList(dynamic data) {
  List? raw;
  if (data is List) {
    raw = data;
  } else if (data is Map) {
    final items = data['items'] ?? data['data'];
    if (items is List) raw = items;
  }
  if (raw == null) return [];
  return raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
}
