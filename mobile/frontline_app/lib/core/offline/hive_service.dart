import 'package:hive_flutter/hive_flutter.dart';

/// Hive type IDs — permanent, never reuse a number once deployed.
/// 0: reserved for FormSubmission (Phase 1)
/// 1: reserved for Announcement (Phase 1)

class HiveService {
  HiveService._();

  static const String pendingSubmissionsBox = 'pending_submissions';
  static const String announcementsCacheBox = 'announcements_cache';

  /// Call once from main() before runApp().
  static Future<void> init() async {
    await Hive.initFlutter();
    // Adapters registered here once Phase 1 models are generated.
    // e.g. Hive.registerAdapter(PendingSubmissionAdapter());
    await Hive.openBox<Map>(pendingSubmissionsBox);
    await Hive.openBox<Map>(announcementsCacheBox);
  }

  static Box<Map> get pendingSubmissions =>
      Hive.box<Map>(pendingSubmissionsBox);

  static Box<Map> get announcementsCache =>
      Hive.box<Map>(announcementsCacheBox);
}
