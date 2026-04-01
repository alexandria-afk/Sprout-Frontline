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
