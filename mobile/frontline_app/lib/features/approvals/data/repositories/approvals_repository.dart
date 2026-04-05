import 'package:frontline_app/core/api/dio_client.dart';

class ApprovalsRepository {
  // ── Workflow approvals ──────────────────────────────────────────────────────

  Future<List<Map<String, dynamic>>> getMyWorkflowTasks() async {
    final response = await DioClient.instance
        .get('/api/v1/workflows/instances/my-tasks');
    final data = response.data;
    if (data is List) return data.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    if (data is Map) {
      final items = data['items'] ?? data['data'];
      if (items is List) return items.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    }
    return [];
  }

  Future<void> approveWorkflowStage({
    required String instanceId,
    required String stageInstanceId,
    String? comment,
  }) async {
    await DioClient.instance.post(
      '/api/v1/workflows/instances/$instanceId/stages/$stageInstanceId/approve',
      data: {if (comment != null) 'comment': comment},
    );
  }

  Future<void> rejectWorkflowStage({
    required String instanceId,
    required String stageInstanceId,
    required String comment,
  }) async {
    await DioClient.instance.post(
      '/api/v1/workflows/instances/$instanceId/stages/$stageInstanceId/reject',
      data: {'comment': comment},
    );
  }

  // ── Shift swaps ─────────────────────────────────────────────────────────────

  Future<List<Map<String, dynamic>>> getPendingSwaps() async {
    final response = await DioClient.instance
        .get('/api/v1/shifts/swaps', queryParameters: {'status': 'pending'});
    final data = response.data;
    if (data is List) return data.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    if (data is Map) {
      final items = data['items'] ?? data['data'];
      if (items is List) return items.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    }
    return [];
  }

  Future<void> respondToSwap(String swapId, String action,
      {String? reason}) async {
    await DioClient.instance.post(
      '/api/v1/shifts/swaps/$swapId/respond',
      data: {
        'action': action,
        if (reason != null) 'rejection_reason': reason,
      },
    );
  }

  // ── Shift claims ────────────────────────────────────────────────────────────

  Future<List<Map<String, dynamic>>> getPendingClaims() async {
    final response = await DioClient.instance
        .get('/api/v1/shifts/claims', queryParameters: {'status': 'pending'});
    final data = response.data;
    if (data is List) return data.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    if (data is Map) {
      final items = data['items'] ?? data['data'];
      if (items is List) return items.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    }
    return [];
  }

  Future<void> respondToClaim(String claimId, String action,
      {String? note}) async {
    await DioClient.instance.post(
      '/api/v1/shifts/claims/$claimId/respond',
      data: {
        'action': action,
        if (note != null) 'manager_note': note,
      },
    );
  }

  // ── Leave requests ──────────────────────────────────────────────────────────

  Future<List<Map<String, dynamic>>> getPendingLeave() async {
    final response = await DioClient.instance
        .get('/api/v1/shifts/leave', queryParameters: {'status': 'pending'});
    final data = response.data;
    if (data is List) return data.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    if (data is Map) {
      final items = data['items'] ?? data['data'];
      if (items is List) return items.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    }
    return [];
  }

  Future<void> respondToLeave(String leaveId, String action) async {
    await DioClient.instance.post(
      '/api/v1/shifts/leave/$leaveId/respond',
      data: {'action': action},
    );
  }
}
