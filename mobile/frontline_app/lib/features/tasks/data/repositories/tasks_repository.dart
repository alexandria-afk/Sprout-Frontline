import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/tasks/data/models/task_models.dart';

class TasksRepository {
  /// Fetch current user's assigned tasks.
  Future<List<Task>> getMyTasks() async {
    final response = await DioClient.instance.get('/api/v1/tasks/my');
    final data = response.data;
    List? raw;
    if (data is List) {
      raw = data;
    } else if (data is Map) {
      final items = data['items'] ?? data['data'];
      if (items is List) raw = items;
    }
    if (raw == null) return [];
    return raw
        .map((e) => Task.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  /// Fetch full task detail with messages and status history.
  Future<TaskDetail> getTask(String taskId) async {
    final response =
        await DioClient.instance.get('/api/v1/tasks/$taskId');
    return TaskDetail.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }

  /// Update task status.
  Future<void> updateStatus(String taskId, String status) async {
    await DioClient.instance.put(
      '/api/v1/tasks/$taskId/status',
      data: {'status': status},
    );
  }

  /// Post a message on a task thread.
  Future<TaskMessage> postMessage(String taskId, String body) async {
    final response = await DioClient.instance.post(
      '/api/v1/tasks/$taskId/messages',
      data: {'body': body},
    );
    return TaskMessage.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }

  /// Mark task messages as read.
  Future<void> markRead(String taskId) async {
    await DioClient.instance.post('/api/v1/tasks/$taskId/read');
  }
}
