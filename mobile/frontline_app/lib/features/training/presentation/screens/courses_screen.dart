import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/training/data/models/training_models.dart';
import 'package:frontline_app/features/training/providers/training_provider.dart';

final _courseFilterProvider = StateProvider<String?>((ref) => null);

class CoursesScreen extends ConsumerWidget {
  const CoursesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncCourses = ref.watch(coursesProvider);
    final filter = ref.watch(_courseFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Training'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.read(coursesProvider.notifier).refresh(),
          ),
        ],
      ),
      body: asyncCourses.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.wifi_off_outlined,
                  size: 48, color: SproutColors.bodyText),
              const SizedBox(height: 16),
              Text('Could not load courses',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () =>
                    ref.read(coursesProvider.notifier).refresh(),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (courses) {
          if (courses.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.school_outlined,
                      size: 64, color: SproutColors.border),
                  const SizedBox(height: 16),
                  Text('No courses available',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text('Courses assigned to you will appear here.',
                      style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            );
          }

          final filtered = filter == null
              ? courses
              : courses.where((c) {
                  final status = c.enrollmentStatus;
                  if (filter == 'in_progress') {
                    return status == 'in_progress';
                  }
                  if (filter == 'assigned') {
                    return status == 'not_started' || status == null;
                  }
                  return true;
                }).toList();

          return Column(
            children: [
              _FilterRow(courses: courses, selected: filter),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () =>
                      ref.read(coursesProvider.notifier).refresh(),
                  child: filtered.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 80),
                          Center(
                            child: Text(
                              'No ${filter == 'in_progress' ? 'in-progress' : 'assigned'} courses',
                              style: Theme.of(context)
                                  .textTheme
                                  .bodyMedium
                                  ?.copyWith(color: SproutColors.bodyText),
                            ),
                          ),
                        ])
                      : ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: filtered.length,
                          itemBuilder: (_, i) =>
                              _CourseCard(course: filtered[i]),
                        ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

// ── Filter pills ──────────────────────────────────────────────────────────────

class _FilterRow extends ConsumerWidget {
  final List<Course> courses;
  final String? selected;
  const _FilterRow({required this.courses, required this.selected});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final inProgressCount = courses
        .where((c) => c.enrollmentStatus == 'in_progress')
        .length;
    final assignedCount = courses
        .where((c) =>
            c.enrollmentStatus == 'not_started' ||
            c.enrollmentStatus == null)
        .length;

    final filters = <(String?, String, int, Color)>[
      (null, 'All', courses.length, SproutColors.bodyText),
      ('in_progress', 'In Progress', inProgressCount, Colors.orange),
      ('assigned', 'Assigned', assignedCount, SproutColors.cyan),
    ];

    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        children: filters.map((f) {
          final isActive = selected == f.$1;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: GestureDetector(
              onTap: () =>
                  ref.read(_courseFilterProvider.notifier).state = f.$1,
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: isActive
                      ? f.$4.withValues(alpha: 0.15)
                      : SproutColors.pageBg,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: isActive
                        ? f.$4.withValues(alpha: 0.4)
                        : SproutColors.border,
                  ),
                ),
                child: Text(
                  '${f.$2} (${f.$3})',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight:
                        isActive ? FontWeight.w600 : FontWeight.normal,
                    color: isActive ? f.$4 : SproutColors.bodyText,
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

// ── Course card ───────────────────────────────────────────────────────────────

class _CourseCard extends StatelessWidget {
  final Course course;
  const _CourseCard({required this.course});

  @override
  Widget build(BuildContext context) {
    final status = course.enrollmentStatus;
    final isCompleted = status == 'completed';
    final isInProgress = status == 'in_progress';
    final (statusLabel, statusColor) = isCompleted
        ? ('Completed', SproutColors.green)
        : isInProgress
            ? ('In Progress', Colors.orange)
            : ('Not Started', SproutColors.cyan);

    return GestureDetector(
      onTap: () => context.go('/training/${course.id}'),
      child: Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: SproutColors.purple.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: course.thumbnailUrl != null
                    ? ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Image.network(course.thumbnailUrl!,
                            fit: BoxFit.cover,
                            errorBuilder: (_, e, st) => const Icon(
                                Icons.school,
                                color: SproutColors.purple)),
                      )
                    : const Icon(Icons.school, color: SproutColors.purple),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(course.title,
                              style:
                                  Theme.of(context).textTheme.titleMedium,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis),
                        ),
                        if (course.isMandatory)
                          Container(
                            margin: const EdgeInsets.only(left: 6),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: Colors.red.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: const Text('Required',
                                style: TextStyle(
                                    color: Colors.red,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600)),
                          ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        // Status pill
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: statusColor.withValues(alpha: 0.10),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(statusLabel,
                              style: TextStyle(
                                  color: statusColor,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500)),
                        ),
                        if (course.estimatedDurationMins != null) ...[
                          const SizedBox(width: 8),
                          const Icon(Icons.timer_outlined,
                              size: 13, color: SproutColors.bodyText),
                          const SizedBox(width: 3),
                          Text('${course.estimatedDurationMins} min',
                              style:
                                  Theme.of(context).textTheme.bodySmall),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 4),
              Icon(
                isCompleted ? Icons.check_circle : Icons.chevron_right,
                color: isCompleted
                    ? SproutColors.green
                    : SproutColors.bodyText,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
