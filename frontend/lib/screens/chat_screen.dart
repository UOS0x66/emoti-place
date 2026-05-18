import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:geolocator/geolocator.dart';
import '../services/chat_service.dart';
import '../services/recommend_service.dart';
import '../services/feedback_service.dart';
import '../services/saved_place_service.dart';
import '../widgets/place_card.dart';
import 'map_screen.dart';
import 'saved_places_screen.dart';

class ChatScreen extends StatefulWidget {
  final String sessionId;
  final String greetingMessage;
  final String personaName;
  final String personaAsset;
  final Color accentColor;

  const ChatScreen({
    super.key,
    required this.sessionId,
    required this.greetingMessage,
    required this.personaName,
    required this.personaAsset,
    required this.accentColor,
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  final List<_ChatMessage> _messages = [];

  @override
  void initState() {
    super.initState();
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

  /// 자동 추천 1회 정책: 사용자 메시지 5턴 도달 시 자동 트리거.
  /// 단, 사용자가 그 전에 위치 아이콘을 눌렀거나 자동 트리거가 한 번 발생한 뒤에는
  /// 다시 자동으로 띄우지 않는다.
  bool _autoRecommendTriggered = false;
  static const int _autoRecommendThreshold = 5;

  String _autoRecommendIntro() {
    if (widget.personaName.contains('조폭')) {
      return '행님, 얘기 들어보고 좋은 데 몇 곳 추려봤습니다. 한번 보십쇼.';
    } else if (widget.personaName.contains('로봇')) {
      return '감정 데이터 누적 충분, 적합 장소 추천 출력 개시.';
    } else {
      return '아가, 듣고보니 할미가 좋은 데 몇 군데 알어. 한번 가봐.';
    }
  }

  /// 3km 안에 추천할 장소가 없을 때 페르소나 톤으로 알려주는 멘트.
  String _tooFarMessage() {
    if (widget.personaName.contains('조폭')) {
      return '행님, 죄송합니다. 지금 행님 계신 데서 3km 안에는 제가 봐둔 데가 없습니다. 다른 동네에서 다시 찾아보시지요.';
    } else if (widget.personaName.contains('로봇')) {
      return '위치 분석 완료. 반경 3km 내 매칭 장소 0건. 본 시스템, 추천 출력 불가. 위치 이동, 권장.';
    } else {
      return '아이고 아가, 시방 너 있는 데 근처에는 할미가 아는 곳이 없네. 좀 떨어진 동네 가서 다시 한번 봐줘봐라.';
    }
  }

  Future<void> _maybeAutoRecommend() async {
    if (_autoRecommendTriggered) return;
    final userTurnCount = _messages.where((m) => m.isUser).length;
    if (userTurnCount < _autoRecommendThreshold) return;
    _autoRecommendTriggered = true;
    _addPersonaMessage(_autoRecommendIntro());
    await _requestRecommendation();
  }

  Future<void> _requestRecommendation({bool refresh = false}) async {
    if (_recommending) return;
    // 사용자가 명시적으로 추천을 받은 시점에도 자동 트리거 비활성화.
    _autoRecommendTriggered = true;
    setState(() => _recommending = true);

    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );

      final result = refresh
          ? await RecommendService.refresh(
              sessionId: widget.sessionId,
              lat: position.latitude,
              lng: position.longitude,
            )
          : await RecommendService.fetch(
              sessionId: widget.sessionId,
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
        sessionId: widget.sessionId,
        message: text,
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

    // 응답 스트림 종료 후 자동 추천 트리거 검토.
    if (mounted) {
      await _maybeAutoRecommend();
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
    return Scaffold(
      backgroundColor: const Color(0xFF121212),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A1A),
        foregroundColor: Colors.white,
        elevation: 1,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Row(
          children: [
            SizedBox(
              width: 32,
              height: 32,
              child: ClipOval(
                child: SvgPicture.asset(
                  widget.personaAsset,
                  fit: BoxFit.cover,
                ),
              ),
            ),
            const SizedBox(width: 10),
            Text(
              widget.personaName,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: widget.accentColor,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: '내 보관함',
            icon: Icon(Icons.bookmark_outline, color: widget.accentColor),
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => SavedPlacesScreen(
                    accentColor: widget.accentColor,
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
                      color: widget.accentColor,
                    ),
                  )
                : Icon(Icons.place_outlined, color: widget.accentColor),
            onPressed: _recommending ? null : _requestRecommendation,
          ),
        ],
      ),
      body: Column(
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
                                      color: widget.accentColor,
                                    ),
                                  )
                                : Icon(Icons.refresh, size: 18, color: widget.accentColor),
                            label: Text(
                              '다른 장소 추천 받기',
                              style: TextStyle(color: widget.accentColor),
                            ),
                            style: OutlinedButton.styleFrom(
                              side: BorderSide(
                                color: widget.accentColor.withValues(alpha: 0.5),
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
                      accentColor: widget.accentColor,
                      distanceKm: place.distance > 0 ? place.distance : null,
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
                  accentColor: widget.accentColor,
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
                      color: widget.accentColor,
                    ),
                  ),
                ],
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
