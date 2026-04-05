import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/features/dashboard/data/models/dashboard_summary.dart';
import 'package:frontline_app/features/dashboard/data/repositories/dashboard_repository.dart';

final dashboardRepositoryProvider = Provider<DashboardRepository>(
  (_) => DashboardRepository(),
);

/// Fetches the live KPI summary from the backend.
/// Dashboard data is always fresh — no offline cache.
final dashboardSummaryProvider = FutureProvider<DashboardSummary>((ref) {
  final repo = ref.read(dashboardRepositoryProvider);
  return repo.getSummary();
});

/// Audit compliance rate — rolling 30 days (manager/admin stat card).
final auditComplianceProvider = FutureProvider<double?>((ref) {
  final repo = ref.read(dashboardRepositoryProvider);
  return repo.getAuditComplianceRate();
});

/// Training completion rate (manager/admin stat card).
final trainingCompletionProvider = FutureProvider<double?>((ref) {
  final repo = ref.read(dashboardRepositoryProvider);
  return repo.getTrainingCompletionRate();
});

/// Published shifts count today (manager/admin stat card).
final shiftsTodayCountProvider = FutureProvider<int?>((ref) {
  final repo = ref.read(dashboardRepositoryProvider);
  return repo.getShiftsTodayCount();
});
