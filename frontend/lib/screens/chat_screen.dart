import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../widgets/place_card.dart';
import 'map_screen.dart';

class ChatScreen extends StatefulWidget {
  final String personaName;
  final String personaAsset;
  final Color accentColor;

  const ChatScreen({
    super.key,
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
    // 페르소나 첫 인사
    _addPersonaMessage(_getGreeting());
  }

  String _getGreeting() {
    if (widget.personaName.contains('조폭')) {
      return '정성을 다해 모시겠습니다, 행님!';
    } else if (widget.personaName.contains('로봇')) {
      return '시스템 준비 완료, 당신 이야기, 수신 대기';
    } else {
      return '아가, 힘든 일있으믄 할미한테 속시원히 털어나';
    }
  }

  void _addPersonaMessage(String text) {
    setState(() {
      _messages.add(_ChatMessage(text: text, isUser: false));
    });
    _scrollToBottom();
  }

  void _sendMessage() {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    setState(() {
      _messages.add(_ChatMessage(text: text, isUser: true));
    });
    _messageController.clear();
    _scrollToBottom();

    // TODO: 백엔드 LLM API 호출 후 응답 받기
    Future.delayed(const Duration(milliseconds: 800), () {
      _addMockResponse();
    });
  }

  void _addMockResponse() {
    // 3번째 사용자 메시지마다 장소 추천 카드 포함
    final userMessageCount = _messages.where((m) => m.isUser).length;

    if (userMessageCount % 3 == 0) {
      _addPersonaMessage(_getRecommendText());
      setState(() {
        _messages.add(_ChatMessage(
          text: '',
          isUser: false,
          place: _getMockPlace(),
        ));
      });
      _scrollToBottom();
    } else {
      _addPersonaMessage(_getMockResponse());
    }
  }

  String _getMockResponse() {
    if (widget.personaName.contains('조폭')) {
      return '행님, 저만 믿으십쇼! 제가 좋은 데 알아보겠습니다.';
    } else if (widget.personaName.contains('로봇')) {
      return '입력 수신. 감정 파라미터 분석 중. 잠시 대기.';
    } else {
      return '아이고, 그런 일이 있었구나. 할미가 다 들어줄께.';
    }
  }

  String _getRecommendText() {
    if (widget.personaName.contains('조폭')) {
      return '행님, 제가 좋은 데 알아왔습니다! 한번 가보십쇼.';
    } else if (widget.personaName.contains('로봇')) {
      return '분석 완료. 감정 벡터 매칭 결과, 최적 장소 1건 도출.';
    } else {
      return '아가, 할미가 딱 좋은 데 알어. 여기 가봐라.';
    }
  }

  _PlaceData _getMockPlace() {
    return const _PlaceData(
      name: '숲속 쉼터 카페',
      category: '카페',
      address: '서울특별시 성동구 서울숲2길 32-8',
      lat: 37.5445,
      lng: 127.0374,
      atmosphereText: '조용하고 따뜻한 분위기, 혼자 오기 좋은 곳',
      operatingHours: '09:00 - 22:00',
      maxGroupSize: 4,
      isOutdoor: false,
      personaReason: '지친 마음을 달래기에 딱 좋은 공간입니다.',
    );
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
                if (message.place != null) {
                  return Align(
                    alignment: Alignment.centerLeft,
                    child: PlaceCard(
                      name: message.place!.name,
                      category: message.place!.category,
                      address: message.place!.address,
                      atmosphereText: message.place!.atmosphereText,
                      operatingHours: message.place!.operatingHours,
                      maxGroupSize: message.place!.maxGroupSize,
                      isOutdoor: message.place!.isOutdoor,
                      personaReason: message.place!.personaReason,
                      accentColor: widget.accentColor,
                      onMapTap: () {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => MapScreen(
                              placeName: message.place!.name,
                              address: message.place!.address,
                              lat: message.place!.lat,
                              lng: message.place!.lng,
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

class _PlaceData {
  final String name;
  final String category;
  final String address;
  final double lat;
  final double lng;
  final String? atmosphereText;
  final String? operatingHours;
  final int? maxGroupSize;
  final bool isOutdoor;
  final String? personaReason;

  const _PlaceData({
    required this.name,
    required this.category,
    required this.address,
    required this.lat,
    required this.lng,
    this.atmosphereText,
    this.operatingHours,
    this.maxGroupSize,
    this.isOutdoor = false,
    this.personaReason,
  });
}

class _ChatMessage {
  final String text;
  final bool isUser;
  final _PlaceData? place;

  const _ChatMessage({required this.text, required this.isUser, this.place});
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
