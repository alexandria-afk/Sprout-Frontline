import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/features/notifications/data/models/notification_models.dart';
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
    } catch (_) {}
    // Refresh to remove from unread list.
    state = await AsyncValue.guard(_load);
    // Also refresh unread count.
    ref.invalidate(unreadCountProvider);
  }
}

final unreadCountProvider = FutureProvider<int>((ref) async {
  final repo = ref.read(notificationsRepositoryProvider);
  return repo.getUnreadCount();
});
