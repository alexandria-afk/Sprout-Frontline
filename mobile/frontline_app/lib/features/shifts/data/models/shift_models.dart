/// A shift assigned to the current user (GET /api/v1/shifts/my).
class Shift {
  final String id;
  final String? locationId;
  final String? locationName;
  final String? role;
  final String startAt;
  final String endAt;
  final String status; // draft, published, open, cancelled
  final String? assignedToUserId;
  final String? notes;
  final bool isOpenShift;

  const Shift({
    required this.id,
    this.locationId,
    this.locationName,
    this.role,
    required this.startAt,
    required this.endAt,
    required this.status,
    this.assignedToUserId,
    this.notes,
    this.isOpenShift = false,
  });

  factory Shift.fromJson(Map<String, dynamic> json) {
    // Location name may be nested under locations.name join.
    final locName = json['location_name'] as String? ??
        (json['locations'] is Map
            ? (json['locations'] as Map)['name'] as String?
            : null);
    return Shift(
      id: json['id'] as String,
      locationId: json['location_id'] as String?,
      locationName: locName,
      role: json['role'] as String?,
      startAt: json['start_at'] as String,
      endAt: json['end_at'] as String,
      status: (json['status'] as String?) ?? 'published',
      assignedToUserId: json['assigned_to_user_id'] as String?,
      notes: json['notes'] as String?,
      isOpenShift: (json['is_open_shift'] as bool?) ?? false,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'location_id': locationId,
        'location_name': locationName,
        'role': role,
        'start_at': startAt,
        'end_at': endAt,
        'status': status,
        'assigned_to_user_id': assignedToUserId,
        'notes': notes,
        'is_open_shift': isOpenShift,
      };
}

/// Attendance record for clock-in / clock-out tracking.
class AttendanceRecord {
  final String id;
  final String? shiftId;
  final String locationId;
  final String clockInAt;
  final String? clockOutAt;
  final String clockInMethod;
  final double? clockInLatitude;
  final double? clockInLongitude;
  final int? totalMinutes;
  final String status; // present, late, early_departure, absent, unverified

  const AttendanceRecord({
    required this.id,
    this.shiftId,
    required this.locationId,
    required this.clockInAt,
    this.clockOutAt,
    required this.clockInMethod,
    this.clockInLatitude,
    this.clockInLongitude,
    this.totalMinutes,
    required this.status,
  });

  factory AttendanceRecord.fromJson(Map<String, dynamic> json) {
    return AttendanceRecord(
      id: json['id'] as String,
      shiftId: json['shift_id'] as String?,
      locationId: json['location_id'] as String,
      clockInAt: json['clock_in_at'] as String,
      clockOutAt: json['clock_out_at'] as String?,
      clockInMethod: (json['clock_in_method'] as String?) ?? 'gps',
      clockInLatitude: (json['clock_in_latitude'] as num?)?.toDouble(),
      clockInLongitude: (json['clock_in_longitude'] as num?)?.toDouble(),
      totalMinutes: json['total_minutes'] as int?,
      status: (json['status'] as String?) ?? 'present',
    );
  }
}

/// Shift claim (for open shifts).
class ShiftClaim {
  final String id;
  final String shiftId;
  final String status; // pending, approved, rejected

  const ShiftClaim({
    required this.id,
    required this.shiftId,
    required this.status,
  });

  factory ShiftClaim.fromJson(Map<String, dynamic> json) {
    return ShiftClaim(
      id: json['id'] as String,
      shiftId: json['shift_id'] as String,
      status: (json['status'] as String?) ?? 'pending',
    );
  }
}

/// A single break record within an attendance session.
class BreakRecord {
  final String id;
  final String breakStartAt;
  final String? breakEndAt;
  final int? durationMinutes;
  final String breakType; // meal, rest, other

  const BreakRecord({
    required this.id,
    required this.breakStartAt,
    this.breakEndAt,
    this.durationMinutes,
    required this.breakType,
  });

  factory BreakRecord.fromJson(Map<String, dynamic> json) {
    return BreakRecord(
      id: (json['id'] as String?) ?? '',
      breakStartAt: (json['break_start_at'] as String?) ?? '',
      breakEndAt: json['break_end_at'] as String?,
      durationMinutes: json['duration_minutes'] as int?,
      breakType: (json['break_type'] as String?) ?? 'rest',
    );
  }
}

/// Aggregated break status for an attendance session.
class BreakStatus {
  final bool onBreak;
  final BreakRecord? activeBreak;
  final List<BreakRecord> breaks;
  final int totalBreakMinutes;

  const BreakStatus({
    required this.onBreak,
    this.activeBreak,
    required this.breaks,
    required this.totalBreakMinutes,
  });

  factory BreakStatus.fromJson(Map<String, dynamic> json) {
    final activeRaw = json['active_break'];
    final breaksRaw = json['breaks'] as List? ?? [];
    return BreakStatus(
      onBreak: (json['on_break'] as bool?) ?? false,
      activeBreak: activeRaw != null && activeRaw is Map
          ? BreakRecord.fromJson(Map<String, dynamic>.from(activeRaw))
          : null,
      breaks: breaksRaw
          .map((e) => BreakRecord.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
      totalBreakMinutes: (json['total_break_minutes'] as int?) ?? 0,
    );
  }
}

/// A shift-swap request between two users.
class ShiftSwapRequest {
  final String id;
  final String status; // pending_peer, pending_manager, approved, rejected, cancelled
  final String? shiftStartAt;
  final String? shiftEndAt;
  final String? locationName;
  final String? requestedById;
  final String? requesterName;
  final String? targetUserId;
  final String? targetUserName;
  final String createdAt;

  const ShiftSwapRequest({
    required this.id,
    required this.status,
    this.shiftStartAt,
    this.shiftEndAt,
    this.locationName,
    this.requestedById,
    this.requesterName,
    this.targetUserId,
    this.targetUserName,
    required this.createdAt,
  });

  factory ShiftSwapRequest.fromJson(Map<String, dynamic> json) {
    final shift = json['shifts'] is Map ? json['shifts'] as Map : null;
    final loc = shift != null && shift['locations'] is Map
        ? shift['locations'] as Map
        : null;
    final requester =
        json['profiles'] is Map ? json['profiles'] as Map : null;
    final target = json['target_profile'] is Map
        ? json['target_profile'] as Map
        : (json['target_user'] is Map ? json['target_user'] as Map : null);
    return ShiftSwapRequest(
      id: (json['id'] as String?) ?? '',
      status: (json['status'] as String?) ?? 'pending_peer',
      shiftStartAt: shift?['start_at'] as String?,
      shiftEndAt: shift?['end_at'] as String?,
      locationName: loc?['name'] as String?,
      requestedById: requester?['id'] as String? ?? json['requested_by'] as String?,
      requesterName: requester?['full_name'] as String?,
      targetUserId: target?['id'] as String? ?? json['target_user_id'] as String?,
      targetUserName: target?['full_name'] as String?,
      createdAt: (json['created_at'] as String?) ?? '',
    );
  }
}

/// A leave / time-off request.
class LeaveRequest {
  final String id;
  final String leaveType; // annual, sick, emergency, unpaid, other
  final String startDate;
  final String endDate;
  final String? reason;
  final String status; // pending, approved, rejected
  final String createdAt;

  const LeaveRequest({
    required this.id,
    required this.leaveType,
    required this.startDate,
    required this.endDate,
    this.reason,
    required this.status,
    required this.createdAt,
  });

  factory LeaveRequest.fromJson(Map<String, dynamic> json) {
    return LeaveRequest(
      id: (json['id'] as String?) ?? '',
      leaveType: (json['leave_type'] as String?) ?? 'other',
      startDate: (json['start_date'] as String?) ?? '',
      endDate: (json['end_date'] as String?) ?? '',
      reason: json['reason'] as String?,
      status: (json['status'] as String?) ?? 'pending',
      createdAt: (json['created_at'] as String?) ?? '',
    );
  }
}
