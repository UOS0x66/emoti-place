import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:geolocator/geolocator.dart';
import '../data/personas.dart';
import '../services/chat_service.dart';
import '../services/recommend_service.dart';
import '../services/feedback_service.dart';
import '../services/saved_place_service.dart';
import '../services/session_service.dart';
import '../widgets/place_card.dart';
import '../widgets/session_sidebar.dart';
import 'map_screen.dart';
import 'saved_places_screen.dart';

class ChatScreen extends StatefulWidget {
  final String sessionId;
  final String greetingMessage;
  final int personaId;

  const ChatScreen({
    super.key,
    required this.sessionId,
    required this.greetingMessage,
    required this.personaId,
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  final List<_ChatMessage> _messages = [];

  // 현재 활성 세션과 페르소나. 사이드바에서 다른 세션을 누르면 통째로 갱신된다.
  late String _sessionId;
  late PersonaInfo _persona;
  bool _loadingSession = false;

  @override
  void initState() {
    super.initState();
    _sessionId = widget.sessionId;
    _persona = personaById(widget.personaId);
    _addPersonaMessage(widget.greetingMessage);
  }

  void _addPersonaMessage(String text) {
    setState(() {
      _messages.add(_ChatMessage(text: text, isUser: false));
    });
    _scrollToBottom();
  }

  bool _sending = false;
  bool _recommending = false;
  Personalization _personalization = Personalization.empty;
  // place_id → 사용자가 누른 평점. ListView 가 카드 위젯을 dispose/recreate 해도
  // 이 맵은 화면 state 라 살아있어, 스크롤 후에도 ♡/✕ 하이라이트가 유지된다.
  final Map<int, PlaceRating?> _placeRatings = {};
  // place_id → 보관함 저장 여부. 같은 이유로 화면 state 에 둔다.
  final Set<int> _savedPlaceIds = {};

  /// 자동 추천 정책: 추천 받은 시점 이후 user 메시지 5턴 더 쌓이면 자동 트리거.
  /// _autoRecommendBaseUserCount = 마지막 추천 시점의 user 메시지 카운트 (baseline).
  /// 다음 트리거 조건: (현재 user 카운트 - baseline) >= threshold.
  /// 추천을 받을 때마다 baseline 갱신 → 5턴 윈도우가 매 추천마다 재시작.
  int _autoRecommendBaseUserCount = 0;
  static const int _autoRecommendThreshold = 5;

  /// 3km 안에 추천할 장소가 없을 때 페르소나 톤으로 알려주는 멘트.
  String _tooFarMessage() {
    if (_persona.name.contains('조폭')) {
      return '행님, 죄송합니다. 지금 행님 계신 데서 3km 안에는 제가 봐둔 데가 없습니다. 다른 동네에서 다시 찾아보시지요.';
    } else if (_persona.name.contains('로봇')) {
      return '위치 분석 완료. 반경 3km 내 매칭 장소 0건. 본 시스템, 추천 출력 불가. 위치 이동, 권장.';
    } else {
      return '아이고 아가, 시방 너 있는 데 근처에는 할미가 아는 곳이 없네. 좀 떨어진 동네 가서 다시 한번 봐줘봐라.';
    }
  }

  /// 현재 페르소나로 새 세션을 생성한 뒤 화면을 초기 상태로 리셋한다.
  Future<void> _startNewSession() async {
    if (_loadingSession) return;
    setState(() => _loadingSession = true);
    try {
      final session = await SessionService.create(_persona.personaId);
      if (!mounted) return;
      setState(() {
        _sessionId = session.sessionId;
        _messages.clear();
        _personalization = Personalization.empty;
        _placeRatings.clear();
        _savedPlaceIds.clear();
        _autoRecommendBaseUserCount = 0;
        _messages.add(_ChatMessage(text: session.greetingMessage, isUser: false));
      });
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('새 대화 생성 실패: $e'),
          backgroundColor: const Color(0xFF333333),
        ),
      );
    } finally {
      if (mounted) setState(() => _loadingSession = false);
    }
  }

  /// 사이드바에서 선택한 세션의 히스토리를 백엔드에서 받아와 화면을 재구성한다.
  /// 이전에 받았던 추천 카드도 같이 복원한다 (recommendation 테이블 기반).
  Future<void> _resumeSession(String sessionId) async {
    if (sessionId == _sessionId) return;
    if (_loadingSession) return;
    setState(() => _loadingSession = true);
    try {
      final detail = await SessionService.getDetail(sessionId);
      if (!mounted) return;
      // 페르소나가 다른 세션일 수도 있으니 함께 교체.
      final nextPersona = personaById(detail.personaId);

      // 추천 카드 복원 — 거리 재계산을 위해 GPS 시도하되, 실패해도 카드는 보여준다.
      List<RecommendedPlace> resumedPlaces = const [];
      try {
        double? lat;
        double? lng;
        try {
          final pos = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.medium,
            ),
          );
          lat = pos.latitude;
          lng = pos.longitude;
        } catch (_) {
          // GPS 실패는 무시 — distance 만 null 로 표시 안 됨, 카드 자체는 OK
        }
        resumedPlaces = await SessionService.getRecommendations(
          sessionId,
          lat: lat,
          lng: lng,
        );
      } catch (_) {
        // 추천 복원 실패는 치명적이지 않음 — 히스토리만 복원하고 넘어간다
      }

      if (!mounted) return;
      setState(() {
        _sessionId = detail.sessionId;
        _persona = nextPersona;
        _messages
          ..clear()
          ..addAll(detail.history.map(
            (m) => _ChatMessage(text: m.content, isUser: m.role == 'user'),
          ));
        _personalization = Personalization.empty;
        _placeRatings.clear();
        _savedPlaceIds.clear();
        // 세션 resume 시 baseline = 현재 user 메시지 카운트.
        // 기존 누적 턴은 다음 자동 추천을 트리거하지 않고, 앞으로 5턴 더 쌓여야 트리거.
        _autoRecommendBaseUserCount = _messages.where((m) => m.isUser).length;

        // 추천 카드 복원: 추천 인트로는 5턴 응답에 이미 자연스럽게 박혀 있으므로
        // (auto_recommend hint 로 backend 가 merged 출력) 별도 멘트 없이 카드만 붙인다.
        if (resumedPlaces.isNotEmpty) {
          for (final place in resumedPlaces) {
            _messages.add(_ChatMessage(text: '', isUser: false, place: place));
          }
          _messages.add(const _ChatMessage(
            text: '',
            isUser: false,
            isRefreshTrigger: true,
          ));
        }
      });
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('대화 로드 실패: $e'),
          backgroundColor: const Color(0xFF333333),
        ),
      );
    } finally {
      if (mounted) setState(() => _loadingSession = false);
    }
  }

  /// 현재 세션이 사이드바에서 삭제됐을 때: 같은 페르소나로 새 세션을 자동 생성.
  Future<void> _onCurrentSessionDeleted(String _) async {
    await _startNewSession();
  }

  Future<void> _requestRecommendation({bool refresh = false}) async {
    if (_recommending) return;
    // 추천 받은 시점부터 다음 자동 추천 윈도우를 새로 시작 — baseline 을 현재 카운트로.
    _autoRecommendBaseUserCount = _messages.where((m) => m.isUser).length;
    setState(() => _recommending = true);

    try {
      // (1) 권한 가드 — denied 면 한 번 요청, deniedForever 면 즉시 폴백.
      LocationPermission perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) {
        throw Exception('위치 권한이 필요합니다. 설정에서 허용해주세요.');
      }

      // (2) 위치 획득 — 마지막 캐시 위치 우선 (즉시 반환, GPS fix 불필요).
      //     캐시 없으면 medium 정확도 + 15초 timeout 으로 새 fix 시도.
      Position? position;
      try {
        position = await Geolocator.getLastKnownPosition();
      } catch (_) {
        position = null;
      }
      position ??= await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 15),
        ),
      );

      final result = refresh
          ? await RecommendService.refresh(
              sessionId: _sessionId,
              lat: position.latitude,
              lng: position.longitude,
            )
          : await RecommendService.fetch(
              sessionId: _sessionId,
              lat: position.latitude,
              lng: position.longitude,
            );

      if (!mounted) return;
      if (result.places.isEmpty) {
        setState(() => _personalization = result.personalization);
        // 3km 밖이라 비었으면 페르소나 멘트를 채팅에 띄운다.
        // 다른 사유(Chroma 후보 0 등)는 기존 스낵바로 폴백.
        if (result.emptyReason == 'too_far') {
          _addPersonaMessage(_tooFarMessage());
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('추천할 장소를 찾지 못했습니다.'),
              backgroundColor: Color(0xFF333333),
            ),
          );
        }
        return;
      }

      setState(() {
        _personalization = result.personalization;
        // 기존 refresh 트리거 제거
        _messages.removeWhere((m) => m.isRefreshTrigger);
        for (final place in result.places) {
          _messages.add(_ChatMessage(text: '', isUser: false, place: place));
        }
        // 새 refresh 트리거 추가
        _messages.add(const _ChatMessage(
          text: '',
          isUser: false,
          isRefreshTrigger: true,
        ));
      });
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('추천 요청 실패: ${e.toString()}'),
          backgroundColor: const Color(0xFF333333),
        ),
      );
    } finally {
      if (mounted) setState(() => _recommending = false);
    }
  }

  Future<void> _sendMessage() async {
    if (_sending) return;
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    // 사용자 메시지를 추가하면 user turn 카운트가 1 증가하는 순간을 미리 계산해서,
    // 이번 턴이 5턴 자동 추천 트리거 턴이면 backend 에 알린다.
    // (backend 가 응답 안에 추천 안내 한 줄을 자연스럽게 박는다.)
    // baseline 차감 → 마지막 추천 이후 새로 쌓인 turn 수가 기준.
    final nextUserTurnCount = _messages.where((m) => m.isUser).length + 1;
    final triggersRecommend =
        (nextUserTurnCount - _autoRecommendBaseUserCount) >= _autoRecommendThreshold;

    setState(() {
      _messages.add(_ChatMessage(text: text, isUser: true));
      // 빈 페르소나 메시지를 먼저 추가하고, 스트림 토큰으로 채운다
      _messages.add(const _ChatMessage(text: '', isUser: false));
      _sending = true;
    });
    _messageController.clear();
    _scrollToBottom();

    final streamingIndex = _messages.length - 1;
    final buffer = StringBuffer();

    try {
      final stream = ChatService.streamMessage(
        sessionId: _sessionId,
        message: text,
        autoRecommend: triggersRecommend,
      );
      await for (final token in stream) {
        buffer.write(token);
        setState(() {
          _messages[streamingIndex] = _ChatMessage(
            text: buffer.toString(),
            isUser: false,
          );
        });
        _scrollToBottom();
      }
    } catch (e) {
      setState(() {
        _messages[streamingIndex] = _ChatMessage(
          text: buffer.isEmpty ? '응답을 받지 못했습니다. (${e.toString()})' : buffer.toString(),
          isUser: false,
        );
      });
    } finally {
      if (mounted) setState(() => _sending = false);
    }

    // 응답 스트림 종료 후 자동 추천 트리거.
    // triggersRecommend == true 였으면 bot 응답에 이미 안내가 박혀있으니
    // 별도 intro 추가 없이 곧장 추천 카드만 emit 한다.
    // baseline 갱신은 _requestRecommendation 진입부에서 수행되므로 여기선 별도 처리 불필요.
    if (mounted && triggersRecommend) {
      await _requestRecommendation();
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final accentColor = _persona.accentColor;
    return Scaffold(
      backgroundColor: const Color(0xFF121212),
      drawer: SessionSidebar(
        currentSessionId: _sessionId,
        onNewSession: _startNewSession,
        onSelectSession: _resumeSession,
        onSessionDeleted: _onCurrentSessionDeleted,
      ),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A1A),
        foregroundColor: Colors.white,
        elevation: 1,
        leadingWidth: 96,
        leading: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Builder(
              builder: (context) => IconButton(
                tooltip: '세션 목록',
                icon: const Icon(Icons.menu),
                onPressed: () => Scaffold.of(context).openDrawer(),
              ),
            ),
            IconButton(
              tooltip: '뒤로가기',
              icon: const Icon(Icons.arrow_back),
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),
        title: Row(
          children: [
            SizedBox(
              width: 32,
              height: 32,
              child: ClipOval(
                child: SvgPicture.asset(
                  _persona.asset,
                  fit: BoxFit.cover,
                ),
              ),
            ),
            const SizedBox(width: 10),
            Text(
              _persona.name,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: accentColor,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: '내 보관함',
            icon: Icon(Icons.bookmark_outline, color: accentColor),
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => SavedPlacesScreen(
                    accentColor: accentColor,
                  ),
                ),
              );
            },
          ),
          IconButton(
            tooltip: '장소 추천 받기',
            icon: _recommending
                ? SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: accentColor,
                    ),
                  )
                : Icon(Icons.place_outlined, color: accentColor),
            onPressed: _recommending ? null : _requestRecommendation,
          ),
        ],
      ),
      body: Stack(
        children: [
          Column(
            children: [
              // 채팅 메시지 영역
              Expanded(
                child: ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  itemCount: _messages.length,
                  itemBuilder: (context, index) {
                    final message = _messages[index];
                    if (message.isRefreshTrigger) {
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Column(
                          children: [
                            Center(
                              child: OutlinedButton.icon(
                                onPressed: _recommending
                                    ? null
                                    : () => _requestRecommendation(refresh: true),
                                icon: _recommending
                                    ? SizedBox(
                                        width: 14,
                                        height: 14,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: accentColor,
                                        ),
                                      )
                                    : Icon(Icons.refresh, size: 18, color: accentColor),
                                label: Text(
                                  '다른 장소 추천 받기',
                                  style: TextStyle(color: accentColor),
                                ),
                                style: OutlinedButton.styleFrom(
                                  side: BorderSide(
                                    color: accentColor.withValues(alpha: 0.5),
                                  ),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 10,
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(20),
                                  ),
                                ),
                              ),
                            ),
                            if (_personalization.nLikes > 0 ||
                                _personalization.excludedDislikes > 0) ...[
                              const SizedBox(height: 6),
                              Text(
                                '맞춤 학습 중 · LIKE ${_personalization.nLikes}개'
                                ' · 반영도 ${(_personalization.prefAlpha * 100).round()}%'
                                '${_personalization.excludedDislikes > 0 ? ' · 제외 ${_personalization.excludedDislikes}' : ''}',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: Color(0xFF888888),
                                ),
                              ),
                            ],
                          ],
                        ),
                      );
                    }
                    if (message.place != null) {
                      final place = message.place!;
                      return Align(
                        alignment: Alignment.centerLeft,
                        child: PlaceCard(
                          name: place.name,
                          category: place.category,
                          address: place.address,
                          photoUrl: place.photo,
                          atmosphereText: place.displayDescription,
                          operatingHours: place.operatingHoursText,
                          maxGroupSize: place.maxGroupSize,
                          isOutdoor: place.isOutdoor,
                          personaReason: place.reason,
                          accentColor: accentColor,
                          distanceKm: (place.distance != null && place.distance! > 0)
                              ? place.distance
                              : null,
                          rating: _placeRatings[place.placeId],
                          saved: _savedPlaceIds.contains(place.placeId),
                          onSavedChanged: (nextSaved) async {
                            final messenger = ScaffoldMessenger.of(context);
                            final wasSaved = _savedPlaceIds.contains(place.placeId);
                            setState(() {
                              if (nextSaved) {
                                _savedPlaceIds.add(place.placeId);
                              } else {
                                _savedPlaceIds.remove(place.placeId);
                              }
                            });
                            try {
                              if (nextSaved) {
                                await SavedPlaceService.save(
                                  placeId: place.placeId,
                                  personaReason: place.reason,
                                );
                              } else {
                                await SavedPlaceService.unsave(placeId: place.placeId);
                              }
                            } catch (e) {
                              if (mounted) {
                                setState(() {
                                  if (wasSaved) {
                                    _savedPlaceIds.add(place.placeId);
                                  } else {
                                    _savedPlaceIds.remove(place.placeId);
                                  }
                                });
                              }
                              messenger.showSnackBar(
                                SnackBar(
                                  content: Text('보관 처리 실패: $e'),
                                  backgroundColor: const Color(0xFF333333),
                                ),
                              );
                              rethrow;
                            }
                          },
                          onMapTap: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => MapScreen(
                                  placeName: place.name,
                                  address: place.address,
                                  lat: place.lat,
                                  lng: place.lng,
                                ),
                              ),
                            );
                          },
                          onRatingChanged: (newRating) async {
                            final messenger = ScaffoldMessenger.of(context);
                            final prev = _placeRatings[place.placeId];
                            // 옵티미스틱 업데이트 — 부모 state 가 source of truth.
                            setState(() => _placeRatings[place.placeId] = newRating);
                            try {
                              if (newRating == null) {
                                await FeedbackService.clear(placeId: place.placeId);
                              } else {
                                await FeedbackService.rate(
                                  placeId: place.placeId,
                                  rating: newRating,
                                );
                              }
                            } catch (e) {
                              if (mounted) {
                                setState(() => _placeRatings[place.placeId] = prev);
                              }
                              messenger.showSnackBar(
                                SnackBar(
                                  content: Text('피드백 저장 실패: $e'),
                                  backgroundColor: const Color(0xFF333333),
                                ),
                              );
                              rethrow;
                            }
                          },
                        ),
                      );
                    }
                    return _MessageBubble(
                      message: message,
                      accentColor: accentColor,
                    );
                  },
                ),
              ),

              // 입력 영역
              Container(
                padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
                decoration: const BoxDecoration(
                  color: Color(0xFF1A1A1A),
                  border: Border(
                    top: BorderSide(color: Color(0xFF2A2A2A), width: 1),
                  ),
                ),
                child: SafeArea(
                  top: false,
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _messageController,
                          style: const TextStyle(color: Colors.white, fontSize: 15),
                          maxLines: 4,
                          minLines: 1,
                          decoration: InputDecoration(
                            hintText: '메시지를 입력하세요',
                            hintStyle: const TextStyle(color: Color(0xFF666666)),
                            filled: true,
                            fillColor: const Color(0xFF252525),
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 10,
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(20),
                              borderSide: BorderSide.none,
                            ),
                          ),
                          onSubmitted: (_) => _sendMessage(),
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        onPressed: _sendMessage,
                        icon: Icon(
                          Icons.send_rounded,
                          color: accentColor,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          if (_loadingSession)
            Positioned.fill(
              child: ColoredBox(
                color: const Color(0xCC121212),
                child: Center(
                  child: CircularProgressIndicator(color: accentColor),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ChatMessage {
  final String text;
  final bool isUser;
  final RecommendedPlace? place;
  final bool isRefreshTrigger;

  const _ChatMessage({
    required this.text,
    required this.isUser,
    this.place,
    this.isRefreshTrigger = false,
  });
}

class _MessageBubble extends StatelessWidget {
  final _ChatMessage message;
  final Color accentColor;

  const _MessageBubble({required this.message, required this.accentColor});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: message.isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        decoration: BoxDecoration(
          color: message.isUser
              ? accentColor.withValues(alpha: 0.2)
              : const Color(0xFF252525),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(message.isUser ? 16 : 4),
            bottomRight: Radius.circular(message.isUser ? 4 : 16),
          ),
        ),
        child: Text(
          message.text,
          style: TextStyle(
            fontSize: 14,
            height: 1.5,
            color: message.isUser ? Colors.white : const Color(0xFFDDDDDD),
          ),
        ),
      ),
    );
  }
}
