import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/core/offline/hive_service.dart';
import 'package:frontline_app/features/forms/data/models/form_assignment.dart';
import 'package:frontline_app/features/forms/data/repositories/forms_repository.dart';

final formsRepositoryProvider = Provider<FormsRepository>(
  (_) => FormsRepository(),
);

/// Provides the current user's form assignments with offline-first caching.
///
/// Flow:
///   1. Emit the last-known cache immediately (empty list on first run)
///   2. Fetch from API; on success, update state + write to Hive
///   3. On network failure, keep the stale cache and expose the error
final formsProvider =
    AsyncNotifierProvider<FormsNotifier, List<FormAssignment>>(
  FormsNotifier.new,
);

class FormsNotifier extends AsyncNotifier<List<FormAssignment>> {
  @override
  Future<List<FormAssignment>> build() async {
    return _load();
  }

  Future<List<FormAssignment>> _load() async {
    // 1. Read stale cache immediately so the UI never shows a blank screen.
    final cached = _fromCache();

    try {
      // 2. Fetch fresh data from backend.
      final repo = ref.read(formsRepositoryProvider);
      final fresh = await repo.getMyAssignments();

      // 3. Persist to Hive.
      _toCache(fresh);
      return fresh;
    } catch (_) {
      // 4. Network failed — serve stale cache; surface error if cache empty.
      if (cached.isNotEmpty) return cached;
      rethrow;
    }
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_load);
  }

  // ── Cache helpers ──────────────────────────────────────────────────────────

  List<FormAssignment> _fromCache() {
    final box = HiveService.formsCache;
    return box.values
        .map((raw) => FormAssignment.fromJson(Map<String, dynamic>.from(raw)))
        .toList();
  }

  void _toCache(List<FormAssignment> assignments) {
    final box = HiveService.formsCache;
    box.clear();
    for (var i = 0; i < assignments.length; i++) {
      box.put(i, assignments[i].toJson());
    }
  }
}
