import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/announcements/data/models/announcement.dart';

class AnnouncementsRepository {
  Future<List<Announcement>> getAnnouncements() async {
    final response = await DioClient.instance.get('/api/v1/announcements/');
    final data = response.data;
    // Response may be {items: [...]}, {data: [...]}, or bare list.
    final List items;
    if (data is Map) {
      items = (data['items'] ?? data['data'] ?? []) as List;
    } else if (data is List) {
      items = data;
    } else {
      return [];
    }
    return items
        .cast<Map<String, dynamic>>()
        .map(Announcement.fromJson)
        .toList();
  }

  /// Fire-and-forget: mark an announcement as read.
  Future<void> markRead(String id) async {
    await DioClient.instance.post('/api/v1/announcements/$id/read');
  }

  /// Acknowledge an announcement.
  Future<void> acknowledge(String id) async {
    await DioClient.instance.post('/api/v1/announcements/$id/acknowledge');
  }
}
