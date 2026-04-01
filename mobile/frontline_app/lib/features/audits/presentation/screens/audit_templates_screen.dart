import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/audits/data/models/audit_models.dart';
import 'package:frontline_app/features/audits/providers/audits_provider.dart';

class AuditTemplatesScreen extends ConsumerWidget {
  const AuditTemplatesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncTemplates = ref.watch(auditTemplatesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Run Audit'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(auditTemplatesProvider),
          ),
        ],
      ),
      body: asyncTemplates.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.wifi_off_outlined,
                  size: 48, color: SproutColors.bodyText),
              const SizedBox(height: 16),
              Text('Could not load templates',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () =>
                    ref.invalidate(auditTemplatesProvider),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (templates) {
          if (templates.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.fact_check_outlined,
                      size: 64, color: SproutColors.border),
                  const SizedBox(height: 16),
                  Text('No audit templates',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text('Audit templates will appear here.',
                      style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            );
          }
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: templates.length,
            itemBuilder: (_, i) =>
                _TemplateCard(template: templates[i]),
          );
        },
      ),
    );
  }
}

class _TemplateCard extends StatelessWidget {
  final AuditTemplate template;
  const _TemplateCard({required this.template});

  @override
  Widget build(BuildContext context) {
    final fieldCount = template.sections
        .fold<int>(0, (sum, s) => sum + s.fields.length);

    return GestureDetector(
      onTap: () => context.go('/audits/fill/${template.id}'),
      child: Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 4,
                height: 48,
                decoration: BoxDecoration(
                  color: SproutColors.cyan,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(template.title,
                        style: Theme.of(context).textTheme.titleMedium,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis),
                    if (template.description != null) ...[
                      const SizedBox(height: 2),
                      Text(template.description!,
                          style: Theme.of(context).textTheme.bodySmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                    ],
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(Icons.checklist, size: 13,
                            color: SproutColors.bodyText),
                        const SizedBox(width: 3),
                        Text('$fieldCount fields',
                            style: Theme.of(context).textTheme.bodySmall),
                        const SizedBox(width: 12),
                        const Icon(Icons.star_outline, size: 13,
                            color: SproutColors.bodyText),
                        const SizedBox(width: 3),
                        Text(
                            'Pass: ${template.passingScore.round()}%',
                            style:
                                Theme.of(context).textTheme.bodySmall),
                      ],
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: SproutColors.bodyText),
            ],
          ),
        ),
      ),
    );
  }
}
