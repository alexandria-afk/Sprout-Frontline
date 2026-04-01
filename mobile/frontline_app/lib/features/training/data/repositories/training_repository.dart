import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/training/data/models/training_models.dart';

class TrainingRepository {
  Future<List<Course>> getCourses() async {
    final response = await DioClient.instance.get('/api/v1/lms/courses');
    return _unwrapList(response.data).map(Course.fromJson).toList();
  }

  Future<List<Enrollment>> getMyEnrollments() async {
    final response =
        await DioClient.instance.get('/api/v1/lms/enrollments/my');
    return _unwrapList(response.data)
          .map(Enrollment.fromJson)
          .toList();
  }

  Future<CourseDetail> getCourseDetail(String courseId) async {
    final response =
        await DioClient.instance.get('/api/v1/lms/courses/$courseId');
    return CourseDetail.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }

  /// Update module progress for an enrollment.
  Future<void> updateProgress({
    required String enrollmentId,
    required String moduleId,
    required String status,
    int? timeSpentSeconds,
  }) async {
    await DioClient.instance.post(
      '/api/v1/lms/enrollments/$enrollmentId/progress',
      data: {
        'module_id': moduleId,
        'status': status,
        'time_spent_seconds': timeSpentSeconds,
      },
    );
  }

  /// Submit quiz answers and get result.
  Future<QuizResult> submitQuiz({
    required String enrollmentId,
    required String moduleId,
    required List<Map<String, String>> answers,
  }) async {
    final response = await DioClient.instance.post(
      '/api/v1/lms/enrollments/$enrollmentId/quiz/submit',
      data: {
        'module_id': moduleId,
        'answers': answers,
      },
    );
    return QuizResult.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }
}

/// Unwrap paginated API responses: {items:[...]}, {data:[...]}, or bare list.
List<Map<String, dynamic>> _unwrapList(dynamic data) {
  if (data is List) return data.cast<Map<String, dynamic>>();
  if (data is Map) {
    final items = data['items'] ?? data['data'];
    if (items is List) return items.cast<Map<String, dynamic>>();
  }
  return [];
}
