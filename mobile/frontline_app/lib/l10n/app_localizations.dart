import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_th.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('th'),
  ];

  /// Dashboard nav label
  ///
  /// In en, this message translates to:
  /// **'Dashboard'**
  String get navDashboard;

  /// Tasks nav label
  ///
  /// In en, this message translates to:
  /// **'Tasks'**
  String get navTasks;

  /// Issues nav label
  ///
  /// In en, this message translates to:
  /// **'Issues'**
  String get navIssues;

  /// Forms nav label
  ///
  /// In en, this message translates to:
  /// **'Forms'**
  String get navForms;

  /// Shifts nav label
  ///
  /// In en, this message translates to:
  /// **'Shifts'**
  String get navShifts;

  /// Announcements nav label
  ///
  /// In en, this message translates to:
  /// **'Announcements'**
  String get navAnnouncements;

  /// Training nav label
  ///
  /// In en, this message translates to:
  /// **'Training'**
  String get navTraining;

  /// Team nav label
  ///
  /// In en, this message translates to:
  /// **'Team'**
  String get navTeam;

  /// Approvals nav label
  ///
  /// In en, this message translates to:
  /// **'Approvals'**
  String get navApprovals;

  /// Audits nav label
  ///
  /// In en, this message translates to:
  /// **'Audits'**
  String get navAudits;

  /// Badges nav label
  ///
  /// In en, this message translates to:
  /// **'Badges'**
  String get navBadges;

  /// Notifications/To-Do nav label
  ///
  /// In en, this message translates to:
  /// **'To-Do'**
  String get navNotifications;

  /// More nav label
  ///
  /// In en, this message translates to:
  /// **'More'**
  String get navMore;

  /// Settings nav label
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get navSettings;

  /// Submit button
  ///
  /// In en, this message translates to:
  /// **'Submit'**
  String get btnSubmit;

  /// Cancel button
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get btnCancel;

  /// Save button
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get btnSave;

  /// Save changes button
  ///
  /// In en, this message translates to:
  /// **'Save Changes'**
  String get btnSaveChanges;

  /// Approve button
  ///
  /// In en, this message translates to:
  /// **'Approve'**
  String get btnApprove;

  /// Reject button
  ///
  /// In en, this message translates to:
  /// **'Reject'**
  String get btnReject;

  /// Clock in button
  ///
  /// In en, this message translates to:
  /// **'Clock In'**
  String get btnClockIn;

  /// Clock out button
  ///
  /// In en, this message translates to:
  /// **'Clock Out'**
  String get btnClockOut;

  /// View all button
  ///
  /// In en, this message translates to:
  /// **'View All'**
  String get btnViewAll;

  /// Claim open shift button
  ///
  /// In en, this message translates to:
  /// **'Claim'**
  String get btnClaim;

  /// Request leave button
  ///
  /// In en, this message translates to:
  /// **'Request Leave'**
  String get btnRequestLeave;

  /// Request shift swap button
  ///
  /// In en, this message translates to:
  /// **'Request Swap'**
  String get btnRequestSwap;

  /// Pending status
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get statusPending;

  /// In progress status
  ///
  /// In en, this message translates to:
  /// **'In Progress'**
  String get statusInProgress;

  /// Completed status
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get statusCompleted;

  /// Overdue status
  ///
  /// In en, this message translates to:
  /// **'Overdue'**
  String get statusOverdue;

  /// Open status
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get statusOpen;

  /// Resolved status
  ///
  /// In en, this message translates to:
  /// **'Resolved'**
  String get statusResolved;

  /// Draft status
  ///
  /// In en, this message translates to:
  /// **'Draft'**
  String get statusDraft;

  /// Approved status
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get statusApproved;

  /// Rejected status
  ///
  /// In en, this message translates to:
  /// **'Rejected'**
  String get statusRejected;

  /// Critical priority
  ///
  /// In en, this message translates to:
  /// **'Critical'**
  String get priorityCritical;

  /// High priority
  ///
  /// In en, this message translates to:
  /// **'High'**
  String get priorityHigh;

  /// Medium priority
  ///
  /// In en, this message translates to:
  /// **'Medium'**
  String get priorityMedium;

  /// Low priority
  ///
  /// In en, this message translates to:
  /// **'Low'**
  String get priorityLow;

  /// My to-do list section header
  ///
  /// In en, this message translates to:
  /// **'My To-Do List'**
  String get dashboardMyToDoList;

  /// My shift today section header
  ///
  /// In en, this message translates to:
  /// **'My Shift Today'**
  String get dashboardMyShiftToday;

  /// Team attendance section header
  ///
  /// In en, this message translates to:
  /// **'Team Attendance'**
  String get dashboardTeamAttendance;

  /// No to-do items message
  ///
  /// In en, this message translates to:
  /// **'All caught up!'**
  String get dashboardAllCaughtUp;

  /// No shift today message
  ///
  /// In en, this message translates to:
  /// **'No shift today'**
  String get dashboardNoShiftToday;

  /// View all link
  ///
  /// In en, this message translates to:
  /// **'View all'**
  String get dashboardViewAll;

  /// Open shifts tab label
  ///
  /// In en, this message translates to:
  /// **'Open Shifts'**
  String get shiftsOpenShifts;

  /// Shift swap tab label
  ///
  /// In en, this message translates to:
  /// **'Shift Swap'**
  String get shiftsShiftSwap;

  /// Empty state for open shifts
  ///
  /// In en, this message translates to:
  /// **'No open shifts available right now'**
  String get shiftsNoOpenShifts;

  /// Shift claimed success message
  ///
  /// In en, this message translates to:
  /// **'Shift claimed! Awaiting manager approval.'**
  String get shiftsShiftClaimed;

  /// Loading indicator label
  ///
  /// In en, this message translates to:
  /// **'Loading...'**
  String get commonLoading;

  /// Empty state message
  ///
  /// In en, this message translates to:
  /// **'No items found'**
  String get commonNoItemsFound;

  /// View all text
  ///
  /// In en, this message translates to:
  /// **'View all'**
  String get commonViewAll;

  /// Language setting label
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get languageLabel;

  /// English language option
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get languageEnglish;

  /// Thai language option
  ///
  /// In en, this message translates to:
  /// **'ไทย (Thai)'**
  String get languageThai;

  /// Settings screen title
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// Language settings section
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get settingsLanguage;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'th'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'th':
      return AppLocalizationsTh();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
