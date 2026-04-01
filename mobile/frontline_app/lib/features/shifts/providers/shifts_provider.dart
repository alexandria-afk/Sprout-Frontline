import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/core/offline/hive_service.dart';
import 'package:frontline_app/features/shifts/data/models/shift_models.dart';
import 'package:frontline_app/features/shifts/data/repositories/shifts_repository.dart';

final shiftsRepositoryProvider = Provider<ShiftsRepository>(
  (_) => ShiftsRepository(),
);

// ── My Shifts ─────────────────────────────────────────────────────────────────

final myShiftsProvider =
    AsyncNotifierProvider<MyShiftsNotifier, List<Shift>>(
  MyShiftsNotifier.new,
);

class MyShiftsNotifier extends AsyncNotifier<List<Shift>> {
  @override
  Future<List<Shift>> build() => _load();

  Future<List<Shift>> _load() async {
    final cached = _fromCache();
    try {
      final repo = ref.read(shiftsRepositoryProvider);
      final fresh = await repo.getMyShifts();
      _toCache(fresh);
      return fresh;
    } catch (_) {
      if (cached.isNotEmpty) return cached;
      rethrow;
    }
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_load);
  }

  List<Shift> _fromCache() {
    final box = HiveService.formsCache; // reuse general cache
    final raw = box.get('shifts_my');
    if (raw == null) return [];
    final list = (raw['items'] as List?) ?? [];
    return list
        .cast<Map>()
        .map((m) => Shift.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  void _toCache(List<Shift> shifts) {
    HiveService.formsCache.put('shifts_my', {
      'items': shifts.map((s) => s.toJson()).toList(),
    });
  }
}

// ── Open Shifts ───────────────────────────────────────────────────────────────

final openShiftsProvider = FutureProvider<List<Shift>>((ref) async {
  final repo = ref.read(shiftsRepositoryProvider);
  return repo.getOpenShifts();
});

// ── Active attendance (for clock-out tracking) ────────────────────────────────

final activeAttendanceProvider =
    StateProvider<AttendanceRecord?>((ref) => null);
