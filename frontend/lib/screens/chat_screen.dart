import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:geolocator/geolocator.dart';
import '../services/chat_service.dart';
import '../services/recommend_service.dart';
import '../widgets/place_card.dart';
import 'map_screen.dart';

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

  Future<void> _requestRecommendation({bool refresh = false}) async {
    if (_recommending) return;
    setState(() => _recommending = true);

    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );

      final places = refresh
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
      if (places.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('추천할 장소를 찾지 못했습니다.'),
            backgroundColor: Color(0xFF333333),
          ),
        );
        return;
      }

      setState(() {
        // 기존 refresh 트리거 제거
        _messages.removeWhere((m) => m.isRefreshTrigger);
        for (final place in places) {
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
                    child: Center(
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
                      atmosphereText: place.atmosphereText,
                      operatingHours: place.operatingHoursText,
                      maxGroupSize: place.maxGroupSize,
                      isOutdoor: place.isOutdoor,
                      personaReason: place.reason,
                      accentColor: widget.accentColor,
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
