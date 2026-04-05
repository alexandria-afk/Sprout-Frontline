import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/notifications/data/models/notification_models.dart';
import 'package:frontline_app/features/notifications/data/models/inbox_models.dart';

class NotificationsRepository {
  Future<List<AppNotification>> getUnread({int limit = 5}) async {
    final response = await DioClient.instance.get(
      '/api/v1/notifications',
      queryParameters: {'is_read': 'false', 'limit': limit},
    );
    final data = response.data;
    final List items;
    if (data is Map) {
      items = (data['items'] ?? data['data'] ?? []) as List;
    } else if (data is List) {
      items = data;
    } else {
      return [];
    }
    return items
        .map((e) => AppNotification.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<int> getUnreadCount() async {
    final response =
        await DioClient.instance.get('/api/v1/notifications/unread-count');
    final data = response.data;
    if (data is Map) return (data['count'] as int?) ?? 0;
    return 0;
  }

  Future<void> markRead(String id) async {
    await DioClient.instance.post('/api/v1/notifications/$id/read');
  }

  Future<void> markAllRead() async {
    await DioClient.instance.post('/api/v1/notifications/read-all');
  }

  Future<List<AppNotification>> getAll({int limit = 50}) async {
    final response = await DioClient.instance.get(
      '/api/v1/notifications',
      queryParameters: {'limit': limit},
    );
    final data = response.data;
    final List items;
    if (data is Map) {
      items = (data['items'] ?? data['data'] ?? []) as List;
    } else if (data is List) {
      items = data;
    } else {
      return [];
    }
    return items
        .map((e) => AppNotification.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<void> dismiss(String id) async {
    await DioClient.instance.post('/api/v1/notifications/$id/dismiss');
  }

  Future<List<InboxItem>> getInboxItems() async {
    final response = await DioClient.instance.get('/api/v1/inbox');
    final data = response.data;
    final List items;
    if (data is Map) {
      items = (data['items'] ?? []) as List;
    } else if (data is List) {
      items = data;
    } else {
      return [];
    }
    return items
        .map((e) => InboxItem.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }
}
