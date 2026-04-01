import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/core/offline/hive_service.dart';
import 'package:frontline_app/features/announcements/data/models/announcement.dart';
import 'package:frontline_app/features/announcements/data/repositories/announcements_repository.dart';

final announcementsRepositoryProvider = Provider<AnnouncementsRepository>(
  (_) => AnnouncementsRepository(),
);

/// Provides announcements with offline-first caching and optimistic markRead.
final announcementsProvider =
    AsyncNotifierProvider<AnnouncementsNotifier, List<Announcement>>(
  AnnouncementsNotifier.new,
);

class AnnouncementsNotifier extends AsyncNotifier<List<Announcement>> {
  @override
  Future<List<Announcement>> build() async {
    return _load();
  }

  Future<List<Announcement>> _load() async {
    final cached = _fromCache();
    try {
      final repo = ref.read(announcementsRepositoryProvider);
      final fresh = await repo.getAnnouncements();
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

  /// Marks an announcement as read optimistically:
  /// updates local state first, then calls the API in the background.
  Future<void> markRead(String id) async {
    final current = state.valueOrNull;
    if (current == null) return;

    // Optimistic update
    state = AsyncData(
      current.map((a) => a.id == id ? a.copyWithRead() : a).toList(),
    );
    _toCache(state.valueOrNull ?? current);

    // Background API call — fire and forget
    try {
      await ref.read(announcementsRepositoryProvider).markRead(id);
    } catch (_) {
      // Non-fatal: local state stays marked as read
    }
  }

  /// Acknowledge an announcement optimistically.
  Future<void> acknowledge(String id) async {
    final current = state.valueOrNull;
    if (current == null) return;

    state = AsyncData(
      current
          .map((a) => a.id == id ? a.copyWithAcknowledged() : a)
          .toList(),
    );
    _toCache(state.valueOrNull ?? current);

    try {
      await ref.read(announcementsRepositoryProvider).acknowledge(id);
    } catch (_) {}
  }

  // ── Cache helpers ──────────────────────────────────────────────────────────

  List<Announcement> _fromCache() {
    final box = HiveService.announcementsCache;
    return box.values
        .map((raw) => Announcement.fromJson(Map<String, dynamic>.from(raw)))
        .toList();
  }

  void _toCache(List<Announcement> items) {
    final box = HiveService.announcementsCache;
    box.clear();
    for (var i = 0; i < items.length; i++) {
      box.put(i, items[i].toJson());
    }
  }
}
