import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/features/approvals/data/repositories/approvals_repository.dart';

final approvalsRepositoryProvider = Provider<ApprovalsRepository>(
  (_) => ApprovalsRepository(),
);

/// All pending approvals across all types.
class ApprovalsData {
  final List<Map<String, dynamic>> workflows;
  final List<Map<String, dynamic>> swaps;
  final List<Map<String, dynamic>> claims;
  final List<Map<String, dynamic>> leave;

  const ApprovalsData({
    this.workflows = const [],
    this.swaps = const [],
    this.claims = const [],
    this.leave = const [],
  });

  int get totalCount =>
      workflows.length + swaps.length + claims.length + leave.length;
}

final approvalsProvider =
    AsyncNotifierProvider<ApprovalsNotifier, ApprovalsData>(
  ApprovalsNotifier.new,
);

class ApprovalsNotifier extends AsyncNotifier<ApprovalsData> {
  @override
  Future<ApprovalsData> build() async {
    final repo = ref.read(approvalsRepositoryProvider);
    final results = await Future.wait([
      repo.getMyWorkflowTasks().catchError((_) => <Map<String, dynamic>>[]),
      repo.getPendingSwaps().catchError((_) => <Map<String, dynamic>>[]),
      repo.getPendingClaims().catchError((_) => <Map<String, dynamic>>[]),
      repo.getPendingLeave().catchError((_) => <Map<String, dynamic>>[]),
    ]);
    return ApprovalsData(
      workflows: results[0],
      swaps: results[1],
      claims: results[2],
      leave: results[3],
    );
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(build);
  }
}

/// Just the count, for the badge.
final pendingApprovalsCountProvider = Provider<int>((ref) {
  return ref.watch(approvalsProvider).valueOrNull?.totalCount ?? 0;
});
