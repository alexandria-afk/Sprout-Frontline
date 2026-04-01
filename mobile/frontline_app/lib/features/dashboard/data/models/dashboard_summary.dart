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

  const DashboardSummary({
    required this.tasksPending,
    required this.tasksInProgress,
    required this.tasksOverdue,
    required this.tasksCompleted,
    required this.issuesOpen,
    required this.issuesInProgress,
    required this.formCompletionRate,
    this.latestAuditScore,
  });

  factory DashboardSummary.fromJson(Map<String, dynamic> json) {
    // Backend returns flat fields for the manager dashboard summary.
    final totalAssignments = (json['total_assignments'] as int?) ?? 0;
    final totalSubmitted = (json['total_submitted'] as int?) ?? 0;

    return DashboardSummary(
      tasksPending: totalAssignments - totalSubmitted,
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
