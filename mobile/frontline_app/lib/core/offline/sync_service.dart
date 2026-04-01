import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/core/offline/connectivity_service.dart';
import 'package:frontline_app/core/offline/hive_service.dart';

/// Watches connectivity and drains the pending_submissions queue when online.
///
/// Each entry in the queue is a Map with:
///   { assignment_id, values, status, queued_at }
///
/// On success the entry is removed. On failure it stays for the next attempt.
final syncServiceProvider = Provider<SyncService>((ref) {
  final service = SyncService(ref);
  // Trigger sync whenever we go back online.
  ref.listen<bool>(connectivityProvider, (prev, isOnline) {
    if (isOnline && prev == false) {
      service.syncPending();
    }
  });
  // Also attempt sync on startup if already online.
  if (ref.read(connectivityProvider)) {
    Future.microtask(() => service.syncPending());
  }
  return service;
});

class SyncService {
  final Ref _ref;
  bool _isSyncing = false;

  SyncService(this._ref);

  /// Attempt to submit all queued form submissions.
  Future<void> syncPending() async {
    if (_isSyncing) return;
    _isSyncing = true;

    try {
      final box = HiveService.pendingSubmissions;
      // Snapshot the keys — we iterate a copy so we can delete during the loop.
      final keys = box.keys.toList();

      for (final key in keys) {
        final raw = box.get(key);
        if (raw == null) continue;

        final entry = Map<String, dynamic>.from(raw);
        try {
          await DioClient.instance.post(
            '/api/v1/forms/submissions',
            data: {
              'assignment_id': entry['assignment_id'],
              'values': entry['values'],
              'status': entry['status'],
            },
          );
          // Success — remove from queue.
          await box.delete(key);
        } on Exception {
          // Leave in queue for next attempt.
          // If we're offline again, stop trying.
          final isOnline = _ref.read(connectivityProvider);
          if (!isOnline) break;
        }
      }
    } finally {
      _isSyncing = false;
    }
  }
}
