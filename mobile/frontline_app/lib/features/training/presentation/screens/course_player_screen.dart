import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/training/data/models/training_models.dart';
import 'package:frontline_app/features/training/providers/training_provider.dart';

class CoursePlayerScreen extends ConsumerWidget {
  final String courseId;
  const CoursePlayerScreen({super.key, required this.courseId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncState = ref.watch(coursePlayerProvider(courseId));

    return asyncState.when(
      loading: () => Scaffold(
        appBar: AppBar(
          title: const Text('Loading...'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.go('/training'),
          ),
        ),
        body: const Center(child: CircularProgressIndicator()),
      ),
      error: (err, _) => Scaffold(
        appBar: AppBar(
          title: const Text('Error'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.go('/training'),
          ),
        ),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('Could not load course',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () =>
                    ref.invalidate(coursePlayerProvider(courseId)),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
      data: (playerState) {
        if (playerState.courseCompleted) {
          return _CompletionScreen(
            courseTitle: playerState.detail.course.title,
            quizResult: playerState.quizResult,
            passingScore: playerState.detail.course.passingScore,
            onDone: () => context.go('/training'),
          );
        }
        final module = playerState.currentModule;
        if (module.moduleType == 'quiz') {
          return _QuizView(courseId: courseId, playerState: playerState);
        }
        return _SlidesView(courseId: courseId, playerState: playerState);
      },
    );
  }
}

// ── Slides view ───────────────────────────────────────────────────────────────

class _SlidesView extends ConsumerWidget {
  final String courseId;
  final CoursePlayerState playerState;
  const _SlidesView({required this.courseId, required this.playerState});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final module = playerState.currentModule;
    final slides = module.slides;
    final slideIdx = playerState.currentSlideIndex;
    final slide = slides.isNotEmpty ? slides[slideIdx] : null;
    final notifier = ref.read(coursePlayerProvider(courseId).notifier);

    return Scaffold(
      appBar: AppBar(
        title: Text(module.title),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => context.go('/training'),
        ),
        actions: [
          if (slides.isNotEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.only(right: 16),
                child: Text(
                  '${slideIdx + 1} / ${slides.length}',
                  style: const TextStyle(color: Colors.white70),
                ),
              ),
            ),
        ],
      ),
      body: slides.isEmpty
          ? const Center(child: Text('No slides in this module.'))
          : GestureDetector(
              onHorizontalDragEnd: (d) {
                if (d.primaryVelocity != null) {
                  if (d.primaryVelocity! < -100) {
                    notifier.nextSlide();
                  } else if (d.primaryVelocity! > 100) {
                    notifier.prevSlide();
                  }
                }
              },
              child: _SlideContent(slide: slide!),
            ),
      bottomNavigationBar: _SlidesNav(
        canPrev: slideIdx > 0,
        canNext: !playerState.isLastSlide,
        isLastSlide: playerState.isLastSlide,
        onPrev: () => notifier.prevSlide(),
        onNext: () => notifier.nextSlide(),
        onComplete: () => notifier.completeModuleAndAdvance(),
      ),
    );
  }
}

class _SlideContent extends StatelessWidget {
  final CourseSlide slide;
  const _SlideContent({required this.slide});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (slide.title != null && slide.title!.isNotEmpty) ...[
            Text(slide.title!,
                style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 16),
          ],
          if (slide.imageUrl != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.network(
                slide.imageUrl!,
                width: double.infinity,
                fit: BoxFit.cover,
                errorBuilder: (_, e, st) => Container(
                  height: 180,
                  decoration: BoxDecoration(
                    color: SproutColors.pageBg,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Center(
                      child: Icon(Icons.image_not_supported,
                          size: 40, color: SproutColors.border)),
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
          if (slide.body != null && slide.body!.isNotEmpty)
            Text(slide.body!,
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    height: 1.6)),
        ],
      ),
    );
  }
}

class _SlidesNav extends StatelessWidget {
  final bool canPrev;
  final bool canNext;
  final bool isLastSlide;
  final VoidCallback onPrev;
  final VoidCallback onNext;
  final VoidCallback onComplete;
  const _SlidesNav({
    required this.canPrev,
    required this.canNext,
    required this.isLastSlide,
    required this.onPrev,
    required this.onNext,
    required this.onComplete,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 12,
        bottom: MediaQuery.of(context).padding.bottom + 12,
      ),
      decoration: const BoxDecoration(
        color: SproutColors.cardBg,
        border: Border(top: BorderSide(color: SproutColors.border)),
      ),
      child: Row(
        children: [
          if (canPrev)
            OutlinedButton.icon(
              onPressed: onPrev,
              icon: const Icon(Icons.arrow_back, size: 16),
              label: const Text('Prev'),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: SproutColors.border),
              ),
            )
          else
            const SizedBox(width: 80),
          const Spacer(),
          isLastSlide
              ? ElevatedButton.icon(
                  onPressed: onComplete,
                  icon: const Icon(Icons.check, size: 16),
                  label: const Text('Complete'),
                )
              : ElevatedButton.icon(
                  onPressed: onNext,
                  icon: const Icon(Icons.arrow_forward, size: 16),
                  label: const Text('Next'),
                ),
        ],
      ),
    );
  }
}

// ── Quiz view ─────────────────────────────────────────────────────────────────

class _QuizView extends ConsumerWidget {
  final String courseId;
  final CoursePlayerState playerState;
  const _QuizView({required this.courseId, required this.playerState});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final module = playerState.currentModule;
    final questions = module.questions;
    final answers = playerState.quizAnswers;
    final result = playerState.quizResult;
    final notifier = ref.read(coursePlayerProvider(courseId).notifier);

    return Scaffold(
      appBar: AppBar(
        title: Text(module.title),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => context.go('/training'),
        ),
      ),
      body: result != null
          ? _QuizResultView(
              result: result,
              questions: questions,
              answers: answers,
              onContinue: () => notifier.completeModuleAndAdvance(),
            )
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: questions.length + 1, // +1 for submit button
              itemBuilder: (_, i) {
                if (i == questions.length) {
                  final allAnswered = questions.every(
                      (q) => answers.containsKey(q.id));
                  return Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: allAnswered &&
                                !playerState.isSubmittingQuiz
                            ? () async {
                                try {
                                  await notifier.submitQuiz();
                                } catch (e) {
                                  if (context.mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                          content:
                                              Text('Submit failed: $e')),
                                    );
                                  }
                                }
                              }
                            : null,
                        child: playerState.isSubmittingQuiz
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white))
                            : const Text('Submit Answers'),
                      ),
                    ),
                  );
                }
                return _QuestionCard(
                  index: i,
                  question: questions[i],
                  selectedOptionId: answers[questions[i].id],
                  onSelect: (optionId) =>
                      notifier.selectAnswer(questions[i].id, optionId),
                );
              },
            ),
    );
  }
}

class _QuestionCard extends StatelessWidget {
  final int index;
  final QuizQuestion question;
  final String? selectedOptionId;
  final ValueChanged<String> onSelect;
  const _QuestionCard({
    required this.index,
    required this.question,
    this.selectedOptionId,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Question ${index + 1}',
                style: TextStyle(
                    color: SproutColors.purple,
                    fontSize: 12,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Text(question.question,
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
            if (question.imageUrl != null) ...[
              const SizedBox(height: 12),
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.network(question.imageUrl!,
                    height: 140, width: double.infinity, fit: BoxFit.cover,
                    errorBuilder: (_, e, st) => const SizedBox.shrink()),
              ),
            ],
            const SizedBox(height: 12),
            ...question.options.map((opt) {
              final isSelected = selectedOptionId == opt.id;
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: GestureDetector(
                  onTap: () => onSelect(opt.id),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: isSelected
                            ? SproutColors.green
                            : SproutColors.border,
                        width: isSelected ? 2 : 1,
                      ),
                      color: isSelected
                          ? SproutColors.green.withValues(alpha: 0.06)
                          : Colors.white,
                    ),
                    child: Row(
                      children: [
                        Icon(
                          isSelected
                              ? Icons.radio_button_checked
                              : Icons.radio_button_unchecked,
                          size: 20,
                          color: isSelected
                              ? SproutColors.green
                              : SproutColors.bodyText,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(opt.text,
                              style:
                                  Theme.of(context).textTheme.bodyMedium),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}

// ── Quiz result ───────────────────────────────────────────────────────────────

class _QuizResultView extends StatelessWidget {
  final QuizResult result;
  final List<QuizQuestion> questions;
  final Map<String, String> answers;
  final VoidCallback onContinue;
  const _QuizResultView({
    required this.result,
    required this.questions,
    required this.answers,
    required this.onContinue,
  });

  @override
  Widget build(BuildContext context) {
    final passed = result.passed;
    final color = passed ? SproutColors.green : Colors.red;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        // Score header
        Center(
          child: Column(
            children: [
              CircleAvatar(
                radius: 40,
                backgroundColor: color.withValues(alpha: 0.12),
                child: Text(
                  '${result.score.round()}%',
                  style: TextStyle(
                      color: color,
                      fontSize: 24,
                      fontWeight: FontWeight.bold),
                ),
              ),
              const SizedBox(height: 12),
              Text(passed ? 'Passed!' : 'Not Passed',
                  style: TextStyle(
                      color: color,
                      fontSize: 20,
                      fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text(
                  '${result.correctCount} of ${result.totalCount} correct',
                  style: Theme.of(context).textTheme.bodyMedium),
            ],
          ),
        ),
        const SizedBox(height: 24),

        // Answer review
        ...questions.asMap().entries.map((entry) {
          final i = entry.key;
          final q = entry.value;
          final selectedId = answers[q.id];
          final correct = q.options.where((o) => o.isCorrect).firstOrNull;
          final isCorrect = selectedId == correct?.id;
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        isCorrect ? Icons.check_circle : Icons.cancel,
                        size: 18,
                        color: isCorrect ? SproutColors.green : Colors.red,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text('Q${i + 1}: ${q.question}',
                            style: const TextStyle(
                                fontWeight: FontWeight.w500, fontSize: 13)),
                      ),
                    ],
                  ),
                  if (!isCorrect && correct != null) ...[
                    const SizedBox(height: 6),
                    Text('Correct answer: ${correct.text}',
                        style: const TextStyle(
                            color: SproutColors.green, fontSize: 12)),
                  ],
                  if (q.explanation != null) ...[
                    const SizedBox(height: 6),
                    Text(q.explanation!,
                        style: Theme.of(context).textTheme.bodySmall),
                  ],
                ],
              ),
            ),
          );
        }),

        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: onContinue,
            child: Text(passed ? 'Continue' : 'Done'),
          ),
        ),
      ],
    );
  }
}

// ── Course completion screen ──────────────────────────────────────────────────

class _CompletionScreen extends StatelessWidget {
  final String courseTitle;
  final QuizResult? quizResult;
  final int passingScore;
  final VoidCallback onDone;
  const _CompletionScreen({
    required this.courseTitle,
    this.quizResult,
    required this.passingScore,
    required this.onDone,
  });

  @override
  Widget build(BuildContext context) {
    final passed = quizResult?.passed ?? true;
    final color = passed ? SproutColors.green : Colors.orange;

    return Scaffold(
      appBar: AppBar(title: const Text('Course Complete')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                passed ? Icons.emoji_events : Icons.assignment_late,
                size: 72,
                color: color,
              ),
              const SizedBox(height: 20),
              Text(
                passed ? 'Congratulations!' : 'Course Finished',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 8),
              Text(courseTitle,
                  style: Theme.of(context).textTheme.bodyLarge,
                  textAlign: TextAlign.center),
              if (quizResult != null) ...[
                const SizedBox(height: 20),
                Text(
                  'Score: ${quizResult!.score.round()}%',
                  style: TextStyle(
                      fontSize: 28, fontWeight: FontWeight.bold, color: color),
                ),
                const SizedBox(height: 4),
                Text(
                  passed
                      ? 'You passed! ($passingScore% required)'
                      : 'Did not pass ($passingScore% required)',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: onDone,
                  child: const Text('Back to Courses'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
