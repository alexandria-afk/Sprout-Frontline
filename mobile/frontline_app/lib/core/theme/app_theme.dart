import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Sprout Solutions brand colours
class SproutColors {
  SproutColors._();

  static const green = Color(0xFF22C55E);       // Primary green — CTAs, active states
  static const greenDark = Color(0xFF16A34A);   // Hover / pressed green
  static const navy = Color(0xFF0D3B2E);        // App bar / nav bar background
  static const purple = Color(0xFF7C3AED);      // Accent / feature labels
  static const cyan = Color(0xFF02AFCE);        // CTA button gradient start
  static const cyanLight = Color(0xFF80D8DE);   // CTA button gradient end
  static const darkText = Color(0xFF1E293B);    // Primary headings
  static const bodyText = Color(0xFF334155);    // Body / secondary text
  static const pageBg = Color(0xFFF8FAFC);      // Scaffold background
  static const cardBg = Color(0xFFFFFFFF);      // Card / surface
  static const border = Color(0xFFE2E8F0);      // Dividers / borders
}

class AppTheme {
  AppTheme._();

  static ThemeData get light {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: SproutColors.green,
      primary: SproutColors.green,
      onPrimary: Colors.white,
      secondary: SproutColors.cyan,
      onSecondary: Colors.white,
      surface: SproutColors.cardBg,
      onSurface: SproutColors.darkText,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: SproutColors.pageBg,

      appBarTheme: const AppBarTheme(
        backgroundColor: SproutColors.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: Colors.white,
          fontSize: 18,
          fontWeight: FontWeight.w600,
        ),
      ),

      textTheme: GoogleFonts.interTextTheme(
        const TextTheme(
          headlineLarge: TextStyle(color: SproutColors.darkText, fontWeight: FontWeight.bold),
          headlineMedium: TextStyle(color: SproutColors.darkText, fontWeight: FontWeight.bold),
          titleLarge: TextStyle(color: SproutColors.darkText, fontWeight: FontWeight.w600),
          titleMedium: TextStyle(color: SproutColors.darkText, fontWeight: FontWeight.w500),
          bodyLarge: TextStyle(color: SproutColors.bodyText),
          bodyMedium: TextStyle(color: SproutColors.bodyText),
          bodySmall: TextStyle(color: SproutColors.bodyText),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: SproutColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: SproutColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: SproutColors.green, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Colors.red),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: SproutColors.green,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),

      cardTheme: CardThemeData(
        color: SproutColors.cardBg,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: SproutColors.border),
        ),
      ),

      dividerTheme: const DividerThemeData(
        color: SproutColors.border,
        thickness: 1,
      ),
    );
  }
}
