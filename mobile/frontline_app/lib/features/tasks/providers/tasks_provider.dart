import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/core/offline/hive_service.dart';
import 'package:frontline_app/features/tasks/data/models/task_models.dart';
import 'package:frontline_app/features/tasks/data/repositories/tasks_repository.dart';

final tasksRepositoryProvider = Provider<TasksRepository>(
  (_) => TasksRepository(),
);

// ── My Tasks list ─────────────────────────────────────────────────────────────

final myTasksProvider =
    AsyncNotifierProvider<MyTasksNotifier, List<Task>>(
  MyTasksNotifier.new,
);

class MyTasksNotifier extends AsyncNotifier<List<Task>> {
  @override
  Future<List<Task>> build() => _load();

  Future<List<Task>> _load() async {
    final cached = _fromCache();
    try {
      final repo = ref.read(tasksRepositoryProvider);
      final fresh = await repo.getMyTasks();
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

  List<Task> _fromCache() {
    final box = HiveService.formsCache;
    final raw = box.get('tasks_my');
    if (raw == null) return [];
    final list = (raw['items'] as List?) ?? [];
    return list
        .cast<Map>()
        .map((m) => Task.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  void _toCache(List<Task> tasks) {
    HiveService.formsCache.put('tasks_my', {
      'items': tasks.map((t) => t.toJson()).toList(),
    });
  }
}

// ── Task detail ───────────────────────────────────────────────────────────────

final taskDetailProvider =
    AsyncNotifierProvider.family<TaskDetailNotifier, TaskDetail, String>(
  TaskDetailNotifier.new,
);

class TaskDetailNotifier extends FamilyAsyncNotifier<TaskDetail, String> {
  bool _markedRead = false;

  @override
  Future<TaskDetail> build(String arg) async {
    final repo = ref.read(tasksRepositoryProvider);
    final detail = await repo.getTask(arg);
    // Mark as read only once per provider lifecycle.
    if (!_markedRead) {
      _markedRead = true;
      repo.markRead(arg).catchError((_) {});
    }
    return detail;
  }

  /// Update task status optimistically.
  Future<void> updateStatus(String newStatus) async {
    final current = state.valueOrNull;
    if (current == null) return;

    // Optimistic: update locally first.
    final updatedTask = Task.fromJson({
      ...current.task.toJson(),
      'status': newStatus,
    });
    state = AsyncData(TaskDetail(
      task: updatedTask,
      messages: current.messages,
      statusHistory: current.statusHistory,
    ));

    try {
      final repo = ref.read(tasksRepositoryProvider);
      await repo.updateStatus(arg, newStatus);
      // Refresh to get server-confirmed state.
      ref.invalidateSelf();
    } catch (_) {
      // Revert on failure.
      state = AsyncData(current);
      rethrow;
    }
  }

  /// Post a message and append it to the local list.
  /// Rethrows on failure so the UI can show an error.
  Future<void> postMessage(String body) async {
    final current = state.valueOrNull;
    if (current == null) return;

    // Let exceptions propagate to the caller.
    final repo = ref.read(tasksRepositoryProvider);
    final msg = await repo.postMessage(arg, body);
    state = AsyncData(TaskDetail(
      task: current.task,
      messages: [...current.messages, msg],
      statusHistory: current.statusHistory,
    ));
  }
}
