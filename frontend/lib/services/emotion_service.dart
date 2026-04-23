import 'api_client.dart';

/// 세션의 현재 감정 분석 결과를 조회한다.
///
/// 백그라운드/디버그/관리자용 유틸리티. 사용자 노출 UI는 없다.
/// 감정 정보는 페르소나 말투의 추천 사유(persona_reason)와
/// 심리학 근거(psych_rationale)를 통해 간접적으로만 사용자에게 전달된다.
///
/// 응답 스키마는 PROMPT_EMOTION 출력과 동일:
/// {
///   joy, trust, fear, surprise, sadness, disgust, anger, anticipation: float,
///   energy_level: "LOW" | "MEDIUM" | "HIGH",
///   companion: "ALONE" | "TWO" | "GROUP",
///   activity_preference: "STATIC" | "ACTIVE",
///   time_preference: "DAY" | "NIGHT" | "NONE"
/// }
class EmotionService {
  static Future<Map<String, dynamic>> get(String sessionId) async {
    final result = await ApiClient.get(
      '/api/emotion/$sessionId',
      withAuth: true,
    );
    return Map<String, dynamic>.from(result as Map);
  }
}
