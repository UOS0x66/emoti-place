import 'package:shared_preferences/shared_preferences.dart';

/// 인증과 무관한 앱 단위 영구 상태 (한 번 본 화면 등).
class AppStorage {
  static const _onboardingKey = 'onboarding_done';

  /// 사용자가 온보딩을 완료했는지 여부. 미설정이면 false.
  static Future<bool> isOnboardingDone() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_onboardingKey) ?? false;
  }

  /// 온보딩 완료 표시. 마지막 페이지에서 "시작하기" 누를 때 호출.
  static Future<void> markOnboardingDone() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_onboardingKey, true);
  }
}
