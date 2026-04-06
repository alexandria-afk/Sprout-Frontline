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
    final box = HiveService.shiftsCache;
    final raw = box.get('shifts_my');
    if (raw == null) return [];
    // Date-based expiry: discard if cached date is not today.
    final cachedDate = raw['cached_date'] as String?;
    final today = DateTime.now().toIso8601String().substring(0, 10);
    if (cachedDate != today) return [];
    final list = (raw['items'] as List?) ?? [];
    return list
        .cast<Map>()
        .map((m) => Shift.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  void _toCache(List<Shift> shifts) {
    final today = DateTime.now().toIso8601String().substring(0, 10);
    HiveService.shiftsCache.put('shifts_my', {
      'items': shifts.map((s) => s.toJson()).toList(),
      'cached_date': today,
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
    AsyncNotifierProvider<ActiveAttendanceNotifier, AttendanceRecord?>(
  ActiveAttendanceNotifier.new,
);

class ActiveAttendanceNotifier extends AsyncNotifier<AttendanceRecord?> {
  @override
  Future<AttendanceRecord?> build() async {
    final repo = ref.read(shiftsRepositoryProvider);
    try {
      return await repo.getActiveAttendance();
    } catch (_) {
      return null;
    }
  }

  void set(AttendanceRecord? record) {
    state = AsyncData(record);
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(() async {
      final repo = ref.read(shiftsRepositoryProvider);
      return repo.getActiveAttendance();
    });
  }
}

// ── Swap Requests ────────────────────────────────────────────────────────────

final swapRequestsProvider =
    AsyncNotifierProvider<SwapRequestsNotifier, List<ShiftSwapRequest>>(
  SwapRequestsNotifier.new,
);

class SwapRequestsNotifier extends AsyncNotifier<List<ShiftSwapRequest>> {
  @override
  Future<List<ShiftSwapRequest>> build() => _load();

  Future<List<ShiftSwapRequest>> _load() async {
    final repo = ref.read(shiftsRepositoryProvider);
    return repo.getSwapRequests();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_load);
  }
}

// ── Leave Requests ───────────────────────────────────────────────────────────

final leaveRequestsProvider =
    AsyncNotifierProvider<LeaveRequestsNotifier, List<LeaveRequest>>(
  LeaveRequestsNotifier.new,
);

class LeaveRequestsNotifier extends AsyncNotifier<List<LeaveRequest>> {
  @override
  Future<List<LeaveRequest>> build() => _load();

  Future<List<LeaveRequest>> _load() async {
    final repo = ref.read(shiftsRepositoryProvider);
    return repo.getLeaveRequests();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_load);
  }
}
