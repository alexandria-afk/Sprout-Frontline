import 'package:flutter/material.dart';
import 'package:frontline_app/core/theme/app_theme.dart';

class FormsScreen extends StatelessWidget {
  const FormsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Forms & Checklists')),
      body: const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.checklist_outlined, size: 48, color: SproutColors.purple),
            SizedBox(height: 16),
            Text('Forms & Checklists', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            SizedBox(height: 8),
            Text('Your assignments load here', style: TextStyle(color: SproutColors.bodyText)),
          ],
        ),
      ),
    );
  }
}
