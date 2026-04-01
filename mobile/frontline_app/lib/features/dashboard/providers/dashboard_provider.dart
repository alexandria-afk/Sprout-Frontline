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
