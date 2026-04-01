/// A course in the LMS (GET /api/v1/lms/courses).
class Course {
  final String id;
  final String title;
  final String? description;
  final String? thumbnailUrl;
  final int? estimatedDurationMins;
  final int passingScore;
  final bool isMandatory;
  final String? enrollmentStatus; // not_started, in_progress, completed, null

  const Course({
    required this.id,
    required this.title,
    this.description,
    this.thumbnailUrl,
    this.estimatedDurationMins,
    this.passingScore = 80,
    this.isMandatory = false,
    this.enrollmentStatus,
  });

  factory Course.fromJson(Map<String, dynamic> json) {
    // Enrollment may be nested inside the course object.
    final enrollment = json['enrollment'] as Map?;
    return Course(
      id: json['id'] as String,
      title: (json['title'] as String?) ?? 'Untitled',
      description: json['description'] as String?,
      thumbnailUrl: json['thumbnail_url'] as String?,
      estimatedDurationMins: json['estimated_duration_mins'] as int?,
      passingScore: (json['passing_score'] as int?) ?? 80,
      isMandatory: (json['is_mandatory'] as bool?) ?? false,
      enrollmentStatus: enrollment?['status'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'description': description,
        'thumbnail_url': thumbnailUrl,
        'estimated_duration_mins': estimatedDurationMins,
        'passing_score': passingScore,
        'is_mandatory': isMandatory,
        'enrollment_status': enrollmentStatus,
      };
}

/// Full course detail with modules (GET /api/v1/lms/courses/{id}).
class CourseDetail {
  final Course course;
  final List<CourseModule> modules;

  const CourseDetail({required this.course, required this.modules});

  factory CourseDetail.fromJson(Map<String, dynamic> json) {
    final rawModules = json['course_modules'] as List? ??
        json['modules'] as List? ??
        [];
    return CourseDetail(
      course: Course.fromJson(json),
      modules: rawModules
          .cast<Map<String, dynamic>>()
          .map(CourseModule.fromJson)
          .toList()
        ..sort((a, b) => a.displayOrder.compareTo(b.displayOrder)),
    );
  }
}

/// A module within a course (slides, quiz, video, pdf).
class CourseModule {
  final String id;
  final String title;
  final String moduleType; // slides, quiz, video, pdf
  final int displayOrder;
  final bool isRequired;
  final int? estimatedDurationMins;
  final List<CourseSlide> slides;
  final List<QuizQuestion> questions;

  const CourseModule({
    required this.id,
    required this.title,
    required this.moduleType,
    this.displayOrder = 0,
    this.isRequired = true,
    this.estimatedDurationMins,
    this.slides = const [],
    this.questions = const [],
  });

  factory CourseModule.fromJson(Map<String, dynamic> json) {
    final rawSlides = json['course_slides'] as List? ??
        json['slides'] as List? ??
        [];
    final rawQuestions = json['quiz_questions'] as List? ??
        json['questions'] as List? ??
        [];
    return CourseModule(
      id: json['id'] as String,
      title: (json['title'] as String?) ?? 'Untitled',
      moduleType: (json['module_type'] as String?) ?? 'slides',
      displayOrder: (json['display_order'] as int?) ?? 0,
      isRequired: (json['is_required'] as bool?) ?? true,
      estimatedDurationMins: json['estimated_duration_mins'] as int?,
      slides: rawSlides
          .cast<Map<String, dynamic>>()
          .map(CourseSlide.fromJson)
          .toList()
        ..sort((a, b) => a.displayOrder.compareTo(b.displayOrder)),
      questions: rawQuestions
          .cast<Map<String, dynamic>>()
          .map(QuizQuestion.fromJson)
          .toList()
        ..sort((a, b) => a.displayOrder.compareTo(b.displayOrder)),
    );
  }
}

/// A slide within a slides module.
class CourseSlide {
  final String id;
  final String? title;
  final String? body;
  final String? imageUrl;
  final int displayOrder;

  const CourseSlide({
    required this.id,
    this.title,
    this.body,
    this.imageUrl,
    this.displayOrder = 0,
  });

  factory CourseSlide.fromJson(Map<String, dynamic> json) {
    return CourseSlide(
      id: json['id'] as String,
      title: json['title'] as String?,
      body: json['body'] as String?,
      imageUrl: json['image_url'] as String?,
      displayOrder: (json['display_order'] as int?) ?? 0,
    );
  }
}

/// A quiz question with multiple-choice options.
class QuizQuestion {
  final String id;
  final String question;
  final String questionType; // multiple_choice, true_false, image_based
  final String? imageUrl;
  final List<QuizOption> options;
  final String? explanation;
  final int displayOrder;

  const QuizQuestion({
    required this.id,
    required this.question,
    this.questionType = 'multiple_choice',
    this.imageUrl,
    this.options = const [],
    this.explanation,
    this.displayOrder = 0,
  });

  factory QuizQuestion.fromJson(Map<String, dynamic> json) {
    final rawOptions = json['options'] as List? ?? [];
    return QuizQuestion(
      id: json['id'] as String,
      question: (json['question'] as String?) ?? '',
      questionType: (json['question_type'] as String?) ?? 'multiple_choice',
      imageUrl: json['image_url'] as String?,
      options: rawOptions
          .cast<Map<String, dynamic>>()
          .map(QuizOption.fromJson)
          .toList(),
      explanation: json['explanation'] as String?,
      displayOrder: (json['display_order'] as int?) ?? 0,
    );
  }
}

/// A single option for a quiz question.
class QuizOption {
  final String id;
  final String text;
  final bool isCorrect;

  const QuizOption({
    required this.id,
    required this.text,
    required this.isCorrect,
  });

  factory QuizOption.fromJson(Map<String, dynamic> json) {
    return QuizOption(
      id: json['id'] as String,
      text: (json['text'] as String?) ?? '',
      isCorrect: (json['is_correct'] as bool?) ?? false,
    );
  }
}

/// An enrollment record for the current user.
class Enrollment {
  final String id;
  final String courseId;
  final String status; // enrolled, in_progress, completed, failed
  final double progressPct;
  final String? completedAt;

  const Enrollment({
    required this.id,
    required this.courseId,
    required this.status,
    this.progressPct = 0,
    this.completedAt,
  });

  factory Enrollment.fromJson(Map<String, dynamic> json) {
    return Enrollment(
      id: json['id'] as String,
      courseId: json['course_id'] as String,
      status: (json['status'] as String?) ?? 'enrolled',
      progressPct: (json['progress_pct'] as num?)?.toDouble() ?? 0,
      completedAt: json['completed_at'] as String?,
    );
  }
}

/// Quiz submission result.
class QuizResult {
  final double score;
  final bool passed;
  final int correctCount;
  final int totalCount;

  const QuizResult({
    required this.score,
    required this.passed,
    required this.correctCount,
    required this.totalCount,
  });

  factory QuizResult.fromJson(Map<String, dynamic> json) {
    return QuizResult(
      score: (json['score'] as num?)?.toDouble() ?? 0,
      passed: (json['passed'] as bool?) ?? false,
      correctCount: (json['correct_count'] as int?) ?? 0,
      totalCount: (json['total_count'] as int?) ?? 0,
    );
  }
}
