import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/features/team/data/repositories/team_repository.dart';

final teamRepositoryProvider = Provider<TeamRepository>(
  (_) => TeamRepository(),
);

class TeamData {
  final List<Map<String, dynamic>> shifts;
  final List<Map<String, dynamic>> attendance;

  const TeamData({this.shifts = const [], this.attendance = const []});

  int get scheduledCount => shifts.length;
  int get clockedInCount =>
      attendance.where((a) => a['clock_out_at'] == null).length;
}

final teamDataProvider = FutureProvider<TeamData>((ref) async {
  final repo = ref.read(teamRepositoryProvider);
  final results = await Future.wait([
    repo.getTodayShifts().catchError((_) => <Map<String, dynamic>>[]),
    repo.getTodayAttendance().catchError((_) => <Map<String, dynamic>>[]),
  ]);
  return TeamData(shifts: results[0], attendance: results[1]);
});
