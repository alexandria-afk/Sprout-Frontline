import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/core/offline/hive_service.dart';
import 'package:frontline_app/features/training/data/models/training_models.dart';
import 'package:frontline_app/features/training/data/repositories/training_repository.dart';

final trainingRepositoryProvider = Provider<TrainingRepository>(
  (_) => TrainingRepository(),
);

// ── Course list (offline-first) ───────────────────────────────────────────────

final coursesProvider =
    AsyncNotifierProvider<CoursesNotifier, List<Course>>(
  CoursesNotifier.new,
);

class CoursesNotifier extends AsyncNotifier<List<Course>> {
  @override
  Future<List<Course>> build() => _load();

  Future<List<Course>> _load() async {
    final cached = _fromCache();
    try {
      final repo = ref.read(trainingRepositoryProvider);
      final fresh = await repo.getCourses();
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

  List<Course> _fromCache() {
    final box = HiveService.formsCache;
    final raw = box.get('lms_courses');
    if (raw == null) return [];
    final list = (raw['items'] as List?) ?? [];
    return list
        .cast<Map>()
        .map((m) => Course.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  void _toCache(List<Course> courses) {
    HiveService.formsCache.put('lms_courses', {
      'items': courses.map((c) => c.toJson()).toList(),
    });
  }
}

// ── Enrollments ───────────────────────────────────────────────────────────────

final myEnrollmentsProvider = FutureProvider<List<Enrollment>>((ref) async {
  final repo = ref.read(trainingRepositoryProvider);
  return repo.getMyEnrollments();
});

// ── Course detail ─────────────────────────────────────────────────────────────

final courseDetailProvider =
    FutureProvider.family<CourseDetail, String>((ref, courseId) async {
  final repo = ref.read(trainingRepositoryProvider);
  return repo.getCourseDetail(courseId);
});

// ── Course player state ───────────────────────────────────────────────────────

class CoursePlayerState {
  final CourseDetail detail;
  final String? enrollmentId;
  final int currentModuleIndex;
  final int currentSlideIndex;
  final Map<String, String> quizAnswers; // questionId → optionId
  final QuizResult? quizResult;
  final bool isSubmittingQuiz;
  final bool courseCompleted;

  const CoursePlayerState({
    required this.detail,
    this.enrollmentId,
    this.currentModuleIndex = 0,
    this.currentSlideIndex = 0,
    this.quizAnswers = const {},
    this.quizResult,
    this.isSubmittingQuiz = false,
    this.courseCompleted = false,
  });

  CourseModule get currentModule =>
      detail.modules[currentModuleIndex];

  bool get isLastModule =>
      currentModuleIndex >= detail.modules.length - 1;

  bool get isLastSlide =>
      currentSlideIndex >= currentModule.slides.length - 1;

  CoursePlayerState copyWith({
    CourseDetail? detail,
    String? enrollmentId,
    int? currentModuleIndex,
    int? currentSlideIndex,
    Map<String, String>? quizAnswers,
    QuizResult? quizResult,
    bool? isSubmittingQuiz,
    bool? courseCompleted,
  }) {
    return CoursePlayerState(
      detail: detail ?? this.detail,
      enrollmentId: enrollmentId ?? this.enrollmentId,
      currentModuleIndex: currentModuleIndex ?? this.currentModuleIndex,
      currentSlideIndex: currentSlideIndex ?? this.currentSlideIndex,
      quizAnswers: quizAnswers ?? this.quizAnswers,
      quizResult: quizResult ?? this.quizResult,
      isSubmittingQuiz: isSubmittingQuiz ?? this.isSubmittingQuiz,
      courseCompleted: courseCompleted ?? this.courseCompleted,
    );
  }
}

final coursePlayerProvider = AsyncNotifierProvider.family<
    CoursePlayerNotifier, CoursePlayerState, String>(
  CoursePlayerNotifier.new,
);

class CoursePlayerNotifier
    extends FamilyAsyncNotifier<CoursePlayerState, String> {
  @override
  Future<CoursePlayerState> build(String arg) async {
    final repo = ref.read(trainingRepositoryProvider);
    final detail = await repo.getCourseDetail(arg);
    // Find enrollment for this course.
    final enrollments =
        ref.read(myEnrollmentsProvider).valueOrNull ?? [];
    final enrollment = enrollments
        .where((e) => e.courseId == arg)
        .firstOrNull;
    return CoursePlayerState(
      detail: detail,
      enrollmentId: enrollment?.id,
    );
  }

  void nextSlide() {
    final s = state.valueOrNull;
    if (s == null) return;
    if (!s.isLastSlide) {
      state = AsyncData(
          s.copyWith(currentSlideIndex: s.currentSlideIndex + 1));
    }
  }

  void prevSlide() {
    final s = state.valueOrNull;
    if (s == null) return;
    if (s.currentSlideIndex > 0) {
      state = AsyncData(
          s.copyWith(currentSlideIndex: s.currentSlideIndex - 1));
    }
  }

  /// Mark current module complete and advance to next.
  Future<void> completeModuleAndAdvance() async {
    final s = state.valueOrNull;
    if (s == null) return;

    // Track progress on backend.
    if (s.enrollmentId != null) {
      final repo = ref.read(trainingRepositoryProvider);
      try {
        await repo.updateProgress(
          enrollmentId: s.enrollmentId!,
          moduleId: s.currentModule.id,
          status: 'completed',
        );
      } catch (_) {
        // Non-blocking — continue even if tracking fails.
      }
    }

    if (s.isLastModule) {
      state = AsyncData(s.copyWith(courseCompleted: true));
    } else {
      state = AsyncData(s.copyWith(
        currentModuleIndex: s.currentModuleIndex + 1,
        currentSlideIndex: 0,
        quizAnswers: {},
        quizResult: null,
      ));
    }
  }

  void selectAnswer(String questionId, String optionId) {
    final s = state.valueOrNull;
    if (s == null) return;
    final updated = Map<String, String>.from(s.quizAnswers);
    updated[questionId] = optionId;
    state = AsyncData(s.copyWith(quizAnswers: updated));
  }

  Future<void> submitQuiz() async {
    final s = state.valueOrNull;
    if (s == null || s.enrollmentId == null) return;

    state = AsyncData(s.copyWith(isSubmittingQuiz: true));
    try {
      final repo = ref.read(trainingRepositoryProvider);
      final answers = s.quizAnswers.entries
          .map((e) => {'question_id': e.key, 'selected_option': e.value})
          .toList();
      final result = await repo.submitQuiz(
        enrollmentId: s.enrollmentId!,
        moduleId: s.currentModule.id,
        answers: answers,
      );
      state = AsyncData(s.copyWith(
        quizResult: result,
        isSubmittingQuiz: false,
      ));
    } catch (e) {
      state = AsyncData(s.copyWith(isSubmittingQuiz: false));
      rethrow;
    }
  }
}
