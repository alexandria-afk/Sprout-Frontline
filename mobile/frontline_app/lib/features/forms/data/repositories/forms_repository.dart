import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/forms/data/models/form_assignment.dart';

class FormsRepository {
  Future<List<FormAssignment>> getMyAssignments() async {
    final response = await DioClient.instance.get('/api/v1/forms/assignments/my');
    final data = response.data;
    if (data is List) {
      return data
          .cast<Map<String, dynamic>>()
          .map(FormAssignment.fromJson)
          .toList();
    }
    return [];
  }
}
