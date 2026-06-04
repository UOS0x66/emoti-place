import 'api_client.dart';
import 'recommend_service.dart';

class SessionResult {
  final String sessionId;
  final String greetingMessage;

  const SessionResult({required this.sessionId, required this.greetingMessage});
}

class SessionInfo {
  final String sessionId;
  final int personaId;
  final String? title;
  final DateTime createdAt;
  final DateTime expiresAt;
  final int messageCount;

  const SessionInfo({
    required this.sessionId,
    required this.personaId,
    this.title,
    required this.createdAt,
    required this.expiresAt,
    required this.messageCount,
  });

  factory SessionInfo.fromJson(Map<String, dynamic> json) {
    return SessionInfo(
      sessionId: json['session_id'] as String,
      personaId: json['persona_id'] as int,
      title: json['title'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
      expiresAt: DateTime.parse(json['expires_at'] as String),
      messageCount: json['message_count'] as int? ?? 0,
    );
  }
}

/// 대화 히스토리의 한 항목. role 은 'user' | 'assistant'.
class SessionHistoryMessage {
  final String role;
  final String content;

  const SessionHistoryMessage({required this.role, required this.content});

  factory SessionHistoryMessage.fromJson(Map<String, dynamic> json) {
    return SessionHistoryMessage(
      role: json['role'] as String? ?? 'assistant',
      content: json['content'] as String? ?? '',
    );
  }
}

class SessionDetail {
  final String sessionId;
  final int personaId;
  final String? title;
  final List<SessionHistoryMessage> history;

  const SessionDetail({
    required this.sessionId,
    required this.personaId,
    this.title,
    required this.history,
  });

  factory SessionDetail.fromJson(Map<String, dynamic> json) {
    final raw = (json['conversation_history'] as List<dynamic>? ?? const []);
    return SessionDetail(
      sessionId: json['session_id'] as String,
      personaId: json['persona_id'] as int,
      title: json['title'] as String?,
      history: raw
          .map((e) => SessionHistoryMessage.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

class SessionService {
  static Future<SessionResult> create(int personaId) async {
    final result = await ApiClient.post(
      '/api/session/create',
      body: {'persona_id': personaId},
      withAuth: true,
    );
    return SessionResult(
      sessionId: result['session_id'] as String,
      greetingMessage: result['greeting_message'] as String,
    );
  }

  static Future<List<SessionInfo>> listSessions() async {
    final result = await ApiClient.get(
      '/api/session/list',
      withAuth: true,
    );
    final sessions = (result['sessions'] as List<dynamic>)
        .map((s) => SessionInfo.fromJson(s as Map<String, dynamic>))
        .toList();
    return sessions;
  }

  /// 세션 상세 + 대화 히스토리 조회. 세션 전환 시 메시지 복원에 사용.
  static Future<SessionDetail> getDetail(String sessionId) async {
    final result = await ApiClient.get(
      '/api/session/$sessionId',
      withAuth: true,
    );
    return SessionDetail.fromJson(result as Map<String, dynamic>);
  }

  /// 세션의 가장 최근 추천 배치(=마지막 추천 시점의 카드 N장)를 복원한다.
  /// lat/lng 가 있으면 거리도 재계산, 없으면 distance=null 로 카드 거리 미표시.
  static Future<List<RecommendedPlace>> getRecommendations(
    String sessionId, {
    double? lat,
    double? lng,
  }) async {
    final query = (lat != null && lng != null) ? '?lat=$lat&lng=$lng' : '';
    final result = await ApiClient.get(
      '/api/session/$sessionId/recommendations$query',
      withAuth: true,
    );
    final list = ((result as Map<String, dynamic>)['places'] as List? ?? const [])
        .cast<Map<String, dynamic>>();
    return list.map(RecommendedPlace.fromJson).toList();
  }

  static Future<void> deleteSession(String sessionId) async {
    await ApiClient.delete(
      '/api/session/$sessionId',
      withAuth: true,
    );
  }

  static Future<String> renameSession(String sessionId, String title) async {
    final result = await ApiClient.patch(
      '/api/session/$sessionId',
      body: {'title': title},
      withAuth: true,
    );
    return (result as Map<String, dynamic>)['title'] as String;
  }
}
