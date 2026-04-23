import 'api_client.dart';

class SessionResult {
  final String sessionId;
  final String greetingMessage;

  const SessionResult({required this.sessionId, required this.greetingMessage});
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
}
