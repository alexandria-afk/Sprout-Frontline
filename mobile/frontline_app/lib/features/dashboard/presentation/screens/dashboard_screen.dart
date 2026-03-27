import 'package:flutter/material.dart';
import 'package:frontline_app/core/theme/app_theme.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Dashboard')),
      body: const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.dashboard_outlined, size: 48, color: SproutColors.green),
            SizedBox(height: 16),
            Text('Dashboard', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            SizedBox(height: 8),
            Text('Summary data coming soon', style: TextStyle(color: SproutColors.bodyText)),
          ],
        ),
      ),
    );
  }
}
