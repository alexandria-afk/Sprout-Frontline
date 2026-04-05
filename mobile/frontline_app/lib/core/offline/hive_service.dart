import 'package:hive_flutter/hive_flutter.dart';

/// Hive type IDs — permanent, never reuse a number once deployed.
/// 0: reserved for FormSubmission (Phase 1)
/// 1: reserved for Announcement (Phase 1)
/// 2: reserved for FormAssignment cache (Phase 1)

class HiveService {
  HiveService._();

  static const String pendingSubmissionsBox = 'pending_submissions';
  static const String announcementsCacheBox = 'announcements_cache';
  static const String formsCacheBox = 'forms_cache';
  static const String shiftsCacheBox = 'shifts_cache';
  static const String insightsCacheBox = 'insights_cache';

  /// Call once from main() before runApp().
  static Future<void> init() async {
    await Hive.initFlutter();
    // TypeAdapters registered here once models are code-generated.
    // Using Box<Map> (raw serialisation) for Phase 1.
    await Hive.openBox<Map>(pendingSubmissionsBox);
    await Hive.openBox<Map>(announcementsCacheBox);
    await Hive.openBox<Map>(formsCacheBox);
    await Hive.openBox<Map>(shiftsCacheBox);
    await Hive.openBox<Map>(insightsCacheBox);
  }

  static Box<Map> get pendingSubmissions =>
      Hive.box<Map>(pendingSubmissionsBox);

  static Box<Map> get announcementsCache =>
      Hive.box<Map>(announcementsCacheBox);

  static Box<Map> get formsCache =>
      Hive.box<Map>(formsCacheBox);

  static Box<Map> get shiftsCache =>
      Hive.box<Map>(shiftsCacheBox);

  static Box<Map> get insightsCache =>
      Hive.box<Map>(insightsCacheBox);

  /// Clear all user-scoped caches on sign-out to prevent data leaking
  /// between accounts.
  static Future<void> clearUserCaches() async {
    await announcementsCache.clear();
    await formsCache.clear();
    await shiftsCache.clear();
    await insightsCache.clear();
  }
}
