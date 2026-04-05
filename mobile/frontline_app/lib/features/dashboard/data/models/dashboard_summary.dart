import 'dart:math';

/// KPI summary returned by GET /api/v1/dashboard/summary
class DashboardSummary {
  final int tasksPending;
  final int tasksInProgress;
  final int tasksOverdue;
  final int tasksCompleted;
  final int issuesOpen;
  final int issuesInProgress;
  final double formCompletionRate; // 0.0 – 1.0
  final double? latestAuditScore;  // null if no audits yet
  final AttendanceData? attendance; // null for staff role

  const DashboardSummary({
    required this.tasksPending,
    required this.tasksInProgress,
    required this.tasksOverdue,
    required this.tasksCompleted,
    required this.issuesOpen,
    required this.issuesInProgress,
    required this.formCompletionRate,
    this.latestAuditScore,
    this.attendance,
  });

  factory DashboardSummary.fromJson(Map<String, dynamic> json) {
    // Backend returns flat fields for the manager dashboard summary.
    final totalAssignments = (json['total_assignments'] as int?) ?? 0;
    final totalSubmitted = (json['total_submitted'] as int?) ?? 0;

    return DashboardSummary(
      tasksPending: max(0, totalAssignments - totalSubmitted),
      tasksInProgress: 0,
      tasksOverdue: (json['pending_count'] as int?) ?? 0,
      tasksCompleted: totalSubmitted,
      issuesOpen: 0,
      issuesInProgress: 0,
      formCompletionRate:
          ((json['completion_rate'] as num?) ?? 0.0).toDouble(),
      latestAuditScore: (json['audit_compliance_rate'] as num?) != null
          ? ((json['audit_compliance_rate'] as num) * 100).toDouble()
          : null,
      attendance: json['attendance'] != null
          ? AttendanceData.fromJson(json['attendance'] as Map<String, dynamic>)
          : null,
    );
  }

  /// Zero state used while API loads.
  factory DashboardSummary.empty() => const DashboardSummary(
        tasksPending: 0,
        tasksInProgress: 0,
        tasksOverdue: 0,
        tasksCompleted: 0,
        issuesOpen: 0,
        issuesInProgress: 0,
        formCompletionRate: 0,
        latestAuditScore: null,
      );
}

// ── Attendance models ────────────────────────────────────────────────────────

class MissingStaff {
  final String userName;
  final String shiftStart;

  const MissingStaff({required this.userName, required this.shiftStart});

  factory MissingStaff.fromJson(Map<String, dynamic> json) => MissingStaff(
        userName: (json['user_name'] as String?) ?? '',
        shiftStart: (json['shift_start'] as String?) ?? '',
      );
}

class LocationAttendance {
  final String locationName;
  final int scheduled;
  final int clockedIn;
  final int late;
  final int presentRate;
  final List<MissingStaff> notClockedIn;

  const LocationAttendance({
    required this.locationName,
    required this.scheduled,
    required this.clockedIn,
    required this.late,
    required this.presentRate,
    required this.notClockedIn,
  });

  factory LocationAttendance.fromJson(Map<String, dynamic> json) =>
      LocationAttendance(
        locationName: (json['location_name'] as String?) ?? '',
        scheduled: (json['scheduled'] as int?) ?? 0,
        clockedIn: (json['clocked_in'] as int?) ?? 0,
        late: (json['late'] as int?) ?? 0,
        presentRate: (json['present_rate'] as int?) ?? 0,
        notClockedIn: (json['not_clocked_in'] as List<dynamic>?)
                ?.map((e) =>
                    MissingStaff.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const [],
      );
}

class AttendanceData {
  final int totalScheduled;
  final int totalClockedIn;
  final int totalLate;
  final int presentRate;
  final int onTimeRate;
  final int utilizationRate;
  final List<LocationAttendance> byLocation;

  const AttendanceData({
    required this.totalScheduled,
    required this.totalClockedIn,
    required this.totalLate,
    required this.presentRate,
    required this.onTimeRate,
    required this.utilizationRate,
    required this.byLocation,
  });

  factory AttendanceData.fromJson(Map<String, dynamic> json) => AttendanceData(
        totalScheduled: (json['total_scheduled'] as int?) ?? 0,
        totalClockedIn: (json['total_clocked_in'] as int?) ?? 0,
        totalLate: (json['total_late'] as int?) ?? 0,
        presentRate: (json['present_rate'] as int?) ?? 0,
        onTimeRate: (json['on_time_rate'] as int?) ?? 0,
        utilizationRate: (json['utilization_rate'] as int?) ?? 0,
        byLocation: (json['by_location'] as List<dynamic>?)
                ?.map((e) =>
                    LocationAttendance.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const [],
      );
}
