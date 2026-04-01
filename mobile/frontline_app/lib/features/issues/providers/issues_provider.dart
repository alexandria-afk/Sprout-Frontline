import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/features/issues/data/models/issue_models.dart';
import 'package:frontline_app/features/issues/data/repositories/issues_repository.dart';

final issuesRepositoryProvider = Provider<IssuesRepository>(
  (_) => IssuesRepository(),
);

/// Fetches the current user's issues.
final myIssuesProvider =
    AsyncNotifierProvider<MyIssuesNotifier, List<Issue>>(
  MyIssuesNotifier.new,
);

class MyIssuesNotifier extends AsyncNotifier<List<Issue>> {
  @override
  Future<List<Issue>> build() async {
    final repo = ref.read(issuesRepositoryProvider);
    return repo.getMyIssues();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final repo = ref.read(issuesRepositoryProvider);
      return repo.getMyIssues();
    });
  }
}

/// Fetches issue categories for the category picker.
final issueCategoriesProvider =
    FutureProvider<List<IssueCategory>>((ref) async {
  final repo = ref.read(issuesRepositoryProvider);
  return repo.getCategories();
});

/// State for the issue reporting form.
class ReportIssueState {
  final String title;
  final String description;
  final String? categoryId;
  final String priority;
  final bool isSafetyRisk;
  final String locationDescription;
  final String? assetId;
  final List<String> photoPaths;
  final IssueClassification? aiSuggestion;
  final bool isClassifying;
  final bool isSubmitting;
  final bool aiAccepted;
  final String? error;

  const ReportIssueState({
    this.title = '',
    this.description = '',
    this.categoryId,
    this.priority = 'medium',
    this.isSafetyRisk = false,
    this.locationDescription = '',
    this.assetId,
    this.photoPaths = const [],
    this.aiSuggestion,
    this.isClassifying = false,
    this.isSubmitting = false,
    this.aiAccepted = false,
    this.error,
  });

  ReportIssueState copyWith({
    String? title,
    String? description,
    String? categoryId,
    String? priority,
    bool? isSafetyRisk,
    String? locationDescription,
    String? assetId,
    List<String>? photoPaths,
    IssueClassification? aiSuggestion,
    bool? isClassifying,
    bool? isSubmitting,
    bool? aiAccepted,
    String? error,
  }) {
    return ReportIssueState(
      title: title ?? this.title,
      description: description ?? this.description,
      categoryId: categoryId ?? this.categoryId,
      priority: priority ?? this.priority,
      isSafetyRisk: isSafetyRisk ?? this.isSafetyRisk,
      locationDescription: locationDescription ?? this.locationDescription,
      assetId: assetId ?? this.assetId,
      photoPaths: photoPaths ?? this.photoPaths,
      aiSuggestion: aiSuggestion ?? this.aiSuggestion,
      isClassifying: isClassifying ?? this.isClassifying,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      aiAccepted: aiAccepted ?? this.aiAccepted,
      error: error,
    );
  }
}

final reportIssueProvider =
    NotifierProvider<ReportIssueNotifier, ReportIssueState>(
  ReportIssueNotifier.new,
);

class ReportIssueNotifier extends Notifier<ReportIssueState> {
  @override
  ReportIssueState build() => const ReportIssueState();

  void setTitle(String v) => state = state.copyWith(title: v);
  void setDescription(String v) => state = state.copyWith(description: v);
  void setCategory(String v) => state = state.copyWith(categoryId: v);
  void setPriority(String v) => state = state.copyWith(priority: v);
  void setSafetyRisk(bool v) => state = state.copyWith(isSafetyRisk: v);
  void setLocationDescription(String v) =>
      state = state.copyWith(locationDescription: v);
  void setAssetId(String? v) => state = state.copyWith(assetId: v);

  void addPhoto(String path) =>
      state = state.copyWith(photoPaths: [...state.photoPaths, path]);

  void removePhoto(String path) => state = state.copyWith(
      photoPaths: state.photoPaths.where((p) => p != path).toList());

  /// Accept the AI suggestion — apply category, priority, safety risk, title.
  void acceptSuggestion() {
    final s = state.aiSuggestion;
    if (s == null) return;
    state = state.copyWith(
      categoryId: s.categoryId ?? state.categoryId,
      priority: s.priority,
      isSafetyRisk: s.isSafetyRisk,
      title: s.suggestedTitle.isNotEmpty ? s.suggestedTitle : state.title,
      aiAccepted: true,
    );
  }

  /// Classify the issue via AI after user enters description.
  Future<void> classify() async {
    if (state.description.trim().length < 10) return;
    state = state.copyWith(isClassifying: true, error: null);
    try {
      final repo = ref.read(issuesRepositoryProvider);
      final categories =
          ref.read(issueCategoriesProvider).valueOrNull ?? [];
      final result = await repo.classifyIssue(
        title: state.title,
        description: state.description,
        categories: categories,
      );
      state = state.copyWith(aiSuggestion: result, isClassifying: false);
    } catch (e) {
      // AI classification is non-blocking — just hide the suggestion.
      state = state.copyWith(isClassifying: false);
    }
  }

  /// Submit the issue.
  Future<bool> submit() async {
    if (state.categoryId == null) return false;
    state = state.copyWith(isSubmitting: true, error: null);
    try {
      final repo = ref.read(issuesRepositoryProvider);
      await repo.createIssue(
        title: state.title,
        description: state.description,
        categoryId: state.categoryId!,
        priority: state.priority,
        isSafetyRisk: state.isSafetyRisk,
        locationDescription: state.locationDescription,
        assetId: state.assetId,
        photoUrls: state.photoPaths,
      );
      state = state.copyWith(isSubmitting: false);
      return true;
    } catch (e) {
      state = state.copyWith(
        isSubmitting: false,
        error: e.toString(),
      );
      return false;
    }
  }

  void reset() => state = const ReportIssueState();
}
