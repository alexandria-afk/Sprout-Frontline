/// Represents a form template structure returned by
/// GET /api/v1/forms/assignments/{id}/template
class FormTemplate {
  final String id;
  final String title;
  final String? description;
  final String type; // 'checklist' | 'form' | 'audit' | 'pull_out'
  final List<FormFieldDef> fields;

  const FormTemplate({
    required this.id,
    required this.title,
    this.description,
    required this.type,
    required this.fields,
  });

  factory FormTemplate.fromJson(Map<String, dynamic> json) {
    // Fields may be at top level or nested inside sections.
    final allFields = <FormFieldDef>[];

    // Try top-level fields first.
    final rawFields = json['fields'] as List?;
    if (rawFields != null && rawFields.isNotEmpty) {
      allFields.addAll(rawFields
          .cast<Map<String, dynamic>>()
          .map(FormFieldDef.fromJson));
    }

    // Also extract from sections[].fields[].
    final rawSections = json['sections'] as List? ?? [];
    for (final section in rawSections) {
      if (section is Map) {
        final sectionFields = section['fields'] as List? ?? [];
        allFields.addAll(sectionFields
            .cast<Map<String, dynamic>>()
            .map(FormFieldDef.fromJson));
      }
    }

    return FormTemplate(
      id: (json['id'] as String?) ?? '',
      title: (json['title'] as String?) ?? 'Untitled',
      description: json['description'] as String?,
      type: (json['type'] as String?) ?? 'form',
      fields: allFields,
    );
  }
}

/// A single field definition within a form template.
class FormFieldDef {
  final String id;
  final String label;
  final String type; // text, number, checkbox, dropdown, multi_select, photo, signature, datetime
  final bool required;
  final String? placeholder;
  final List<String> options; // for dropdown / multi_select
  final ConditionalLogic? conditionalLogic;

  const FormFieldDef({
    required this.id,
    required this.label,
    required this.type,
    this.required = false,
    this.placeholder,
    this.options = const [],
    this.conditionalLogic,
  });

  factory FormFieldDef.fromJson(Map<String, dynamic> json) {
    final rawOptions = json['options'] as List?;
    return FormFieldDef(
      id: (json['id'] as String?) ?? '',
      label: (json['label'] as String?) ?? '',
      type: (json['field_type'] as String?) ?? (json['type'] as String?) ?? 'text',
      required: (json['is_required'] as bool?) ?? (json['required'] as bool?) ?? false,
      placeholder: json['placeholder'] as String?,
      options: rawOptions?.map((e) => e.toString()).toList() ?? [],
      conditionalLogic: json['conditional_logic'] != null
          ? ConditionalLogic.fromJson(
              Map<String, dynamic>.from(json['conditional_logic'] as Map))
          : null,
    );
  }
}

/// Conditional visibility rule: show this field only when another field
/// matches a given condition.
class ConditionalLogic {
  final String dependsOn; // field ID
  final String operator; // 'equals' | 'not_equals' | 'contains' | 'not_empty'
  final dynamic value;

  const ConditionalLogic({
    required this.dependsOn,
    required this.operator,
    this.value,
  });

  factory ConditionalLogic.fromJson(Map<String, dynamic> json) {
    return ConditionalLogic(
      dependsOn: (json['depends_on'] as String?) ?? '',
      operator: (json['operator'] as String?) ?? 'equals',
      value: json['value'],
    );
  }

  /// Evaluate whether this condition is met given current form values.
  bool evaluate(Map<String, dynamic> values) {
    final actual = values[dependsOn];
    switch (operator) {
      case 'equals':
        return _looseEquals(actual, value);
      case 'not_equals':
        return !_looseEquals(actual, value);
      case 'contains':
        if (actual is List) return actual.contains(value);
        return actual.toString().contains(value.toString());
      case 'not_empty':
        if (actual == null) return false;
        if (actual is String) return actual.isNotEmpty;
        if (actual is List) return actual.isNotEmpty;
        return true;
      default:
        return true;
    }
  }

  /// Compare two values loosely: handles bool, num, and String without
  /// false negatives from toString() mismatches (e.g. `true` vs `"true"`).
  static bool _looseEquals(dynamic a, dynamic b) {
    if (a == b) return true;
    if (a == null || b == null) return false;
    // Bool comparison: "true"/"false" strings should match bool values.
    if (a is bool || b is bool) {
      return _toBool(a) == _toBool(b);
    }
    // Numeric comparison: 5 == "5".
    final na = num.tryParse(a.toString());
    final nb = num.tryParse(b.toString());
    if (na != null && nb != null) return na == nb;
    // Fallback to string comparison.
    return a.toString() == b.toString();
  }

  static bool _toBool(dynamic v) {
    if (v is bool) return v;
    final s = v.toString().toLowerCase();
    return s == 'true' || s == '1';
  }
}
