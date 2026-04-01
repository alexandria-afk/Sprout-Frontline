import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/ai_insights/data/models/ai_insight_models.dart';

class AIInsightsRepository {
  /// Fetch AI-generated dashboard insights.
  /// Pass [refresh] = true to bypass server cache.
  Future<AIInsightsResponse> getInsights({bool refresh = false}) async {
    final queryParams = <String, dynamic>{};
    if (refresh) queryParams['refresh'] = 'true';

    final response = await DioClient.instance.get(
      '/api/v1/ai/dashboard-insights',
      queryParameters: queryParams,
    );

    return AIInsightsResponse.fromJson(
      Map<String, dynamic>.from(response.data as Map),
    );
  }
}
