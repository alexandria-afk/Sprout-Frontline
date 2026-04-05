import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:frontline_app/core/offline/hive_service.dart';
import 'package:frontline_app/features/ai_insights/data/models/ai_insight_models.dart';
import 'package:frontline_app/features/ai_insights/data/repositories/ai_insights_repository.dart';

// ── Repository provider ──────────────────────────────────────────────────────

final aiInsightsRepositoryProvider = Provider<AIInsightsRepository>(
  (_) => AIInsightsRepository(),
);

// ── Insights data provider (fetches + caches) ────────────────────────────────

final aiInsightsProvider =
    AsyncNotifierProvider<AIInsightsNotifier, AIInsightsResponse>(
  AIInsightsNotifier.new,
);

class AIInsightsNotifier extends AsyncNotifier<AIInsightsResponse> {
  @override
  Future<AIInsightsResponse> build() => _load();

  Future<AIInsightsResponse> _load({bool refresh = false}) async {
    final cached = _fromCache();
    try {
      final repo = ref.read(aiInsightsRepositoryProvider);
      final fresh = await repo.getInsights(refresh: refresh);
      _toCache(fresh);
      return fresh;
    } catch (_) {
      if (cached != null) return cached;
      rethrow;
    }
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() => _load(refresh: true));
  }

  // ── Hive cache (scoped by user ID) ────────────────────────────────────

  String get _cacheKey =>
      'ai_insights_${Supabase.instance.client.auth.currentUser?.id ?? 'anon'}';

  AIInsightsResponse? _fromCache() {
    final box = HiveService.insightsCache;
    final raw = box.get(_cacheKey);
    if (raw == null) return null;
    final data = Map<String, dynamic>.from(raw);
    final cachedDate = data['date'] as String?;
    final today = DateTime.now().toIso8601String().substring(0, 10);
    if (cachedDate != today) return null;
    return AIInsightsResponse.fromJson(
      Map<String, dynamic>.from(data['payload'] as Map),
    );
  }

  void _toCache(AIInsightsResponse response) {
    final today = DateTime.now().toIso8601String().substring(0, 10);
    HiveService.insightsCache.put(_cacheKey, {
      'date': today,
      'payload': response.toJson(),
    });
  }
}

// ── Dismissed insights provider (local-only, cleared daily) ──────────────────

final dismissedInsightsProvider =
    NotifierProvider<DismissedInsightsNotifier, Set<String>>(
  DismissedInsightsNotifier.new,
);

class DismissedInsightsNotifier extends Notifier<Set<String>> {
  @override
  Set<String> build() => _loadDismissed();

  String get _dismissKey =>
      'dismissed_insights_${Supabase.instance.client.auth.currentUser?.id ?? 'anon'}';

  Set<String> _loadDismissed() {
    final box = HiveService.insightsCache;
    final raw = box.get(_dismissKey);
    if (raw == null) return {};
    final data = Map<String, dynamic>.from(raw);
    final storedDate = data['date'] as String?;
    final today = DateTime.now().toIso8601String().substring(0, 10);
    if (storedDate != today) {
      box.delete(_dismissKey);
      return {};
    }
    final ids = (data['ids'] as List?)?.cast<String>() ?? [];
    return ids.toSet();
  }

  void dismiss(String insightKey) {
    final updated = {...state, insightKey};
    state = updated;
    _persist(updated);
  }

  void _persist(Set<String> ids) {
    final today = DateTime.now().toIso8601String().substring(0, 10);
    HiveService.insightsCache.put(_dismissKey, {
      'date': today,
      'ids': ids.toList(),
    });
  }
}
