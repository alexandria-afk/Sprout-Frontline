import 'package:flutter/material.dart';
import 'package:frontline_app/core/theme/app_theme.dart';

class AnnouncementsScreen extends StatelessWidget {
  const AnnouncementsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Announcements')),
      body: const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.campaign_outlined, size: 48, color: SproutColors.cyan),
            SizedBox(height: 16),
            Text('Announcements', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            SizedBox(height: 8),
            Text('Your feed loads here', style: TextStyle(color: SproutColors.bodyText)),
          ],
        ),
      ),
    );
  }
}
