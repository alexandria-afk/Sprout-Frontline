import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/features/notifications/data/models/notification_models.dart';
import 'package:frontline_app/features/notifications/data/models/inbox_models.dart';
import 'package:frontline_app/features/notifications/data/repositories/notifications_repository.dart';

final notificationsRepositoryProvider = Provider<NotificationsRepository>(
  (_) => NotificationsRepository(),
);

final inboxNotificationsProvider =
    AsyncNotifierProvider<InboxNotificationsNotifier, List<AppNotification>>(
  InboxNotificationsNotifier.new,
);

class InboxNotificationsNotifier
    extends AsyncNotifier<List<AppNotification>> {
  @override
  Future<List<AppNotification>> build() => _load();

  Future<List<AppNotification>> _load() async {
    final repo = ref.read(notificationsRepositoryProvider);
    return repo.getUnread(limit: 5);
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_load);
  }

  Future<void> markRead(String id) async {
    final repo = ref.read(notificationsRepositoryProvider);
    try {
      await repo.markRead(id);
    } catch (_) {
      // API failed — list will re-fetch and show correct state
    }
    // Refresh to remove from unread list.
    state = await AsyncValue.guard(_load);
    // Also refresh unread count.
    ref.invalidate(unreadCountProvider);
  }
}

// ── To-Do List (status-based inbox) ──────────────────────────────────────────

final todoItemsProvider =
    AsyncNotifierProvider<TodoItemsNotifier, List<InboxItem>>(
  TodoItemsNotifier.new,
);

class TodoItemsNotifier extends AsyncNotifier<List<InboxItem>> {
  @override
  Future<List<InboxItem>> build() => _load();

  Future<List<InboxItem>> _load() async {
    final repo = ref.read(notificationsRepositoryProvider);
    return repo.getInboxItems();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_load);
  }
}

// ── Notification unread count ─────────────────────────────────────────────────

final unreadCountProvider = FutureProvider<int>((ref) async {
  final repo = ref.read(notificationsRepositoryProvider);
  return repo.getUnreadCount();
});

final allNotificationsProvider =
    AsyncNotifierProvider<AllNotificationsNotifier, List<AppNotification>>(
  AllNotificationsNotifier.new,
);

class AllNotificationsNotifier extends AsyncNotifier<List<AppNotification>> {
  @override
  Future<List<AppNotification>> build() => _load();

  Future<List<AppNotification>> _load() async {
    final repo = ref.read(notificationsRepositoryProvider);
    return repo.getAll(limit: 50);
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_load);
  }

  Future<void> markRead(String id) async {
    final repo = ref.read(notificationsRepositoryProvider);
    try {
      await repo.markRead(id);
    } catch (_) {}
    state = await AsyncValue.guard(_load);
    ref.invalidate(unreadCountProvider);
    ref.invalidate(inboxNotificationsProvider);
  }

  Future<void> dismiss(String id) async {
    final repo = ref.read(notificationsRepositoryProvider);
    try {
      await repo.dismiss(id);
    } catch (_) {}
    state = await AsyncValue.guard(_load);
    ref.invalidate(unreadCountProvider);
    ref.invalidate(inboxNotificationsProvider);
  }
}
