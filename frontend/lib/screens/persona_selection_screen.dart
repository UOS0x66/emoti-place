import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'chat_screen.dart';

class PersonaSelectionScreen extends StatelessWidget {
  const PersonaSelectionScreen({super.key});

  static const _personas = [
    _PersonaData(
      name: '의리 있는 조폭 동생',
      description: '행님 한번만 믿어보십쇼! 의리 하나로 끝까지 모시겠습니다. 거친 세상, 제가 옆에서 든든하게 지켜드리겠습니다.',
      asset: 'assets/images/persona_mob_brother.svg',
      accentColor: Color(0xFFC8A020),
      bgColor: Color(0xFF1A0E06),
    ),
    _PersonaData(
      name: '냉철한 논리 로봇',
      description: '당신 감정, 데이터화. 분석 개시. 최적 변수 추출. 장소 연산. 결과 도출. 오류 없음.',
      asset: 'assets/images/persona_logic_robot.svg',
      accentColor: Color(0xFF00E5FF),
      bgColor: Color(0xFF050F1A),
    ),
    _PersonaData(
      name: '푸근한 욕쟁이 할멈',
      description: '아이고 아가, 힘든 일 있으믄 할미한테 다 털어나. 할미가 좋은 데 알아서 보내줄께.',
      asset: 'assets/images/persona_granny.svg',
      accentColor: Color(0xFFE8762A),
      bgColor: Color(0xFF1A0C04),
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF121212),
      body: SafeArea(
        child: Column(
          children: [
            const SizedBox(height: 32),
            const Text(
              '대화 상대를 선택하세요',
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                color: Colors.white,
                letterSpacing: -0.3,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              '지금 기분에 맞는 페르소나를 골라보세요',
              style: TextStyle(
                fontSize: 14,
                color: Color(0xFF999999),
              ),
            ),
            const SizedBox(height: 28),
            Expanded(
              child: PageView.builder(
                controller: PageController(viewportFraction: 0.82),
                itemCount: _personas.length,
                itemBuilder: (context, index) {
                  return _PersonaCard(persona: _personas[index]);
                },
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

class _PersonaData {
  final String name;
  final String description;
  final String asset;
  final Color accentColor;
  final Color bgColor;

  const _PersonaData({
    required this.name,
    required this.description,
    required this.asset,
    required this.accentColor,
    required this.bgColor,
  });
}

class _PersonaCard extends StatelessWidget {
  final _PersonaData persona;

  const _PersonaCard({required this.persona});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Container(
        decoration: BoxDecoration(
          color: persona.bgColor,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: persona.accentColor.withValues(alpha: 0.3),
            width: 1,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
          child: Column(
            children: [
              // 페르소나 이미지 (상단 70%)
              Expanded(
                flex: 7,
                child: SvgPicture.asset(
                  persona.asset,
                  fit: BoxFit.contain,
                  alignment: Alignment.center,
                ),
              ),

              // 이름 + 소개 (하단 30%)
              Expanded(
                flex: 3,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.start,
                  children: [
                    Text(
                      persona.name,
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: persona.accentColor,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      child: Text(
                        persona.description,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.6,
                          color: Color(0xFFAAAAAA),
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // 선택 버튼
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    // TODO: 세션 생성 API 호출 (user_id + persona_id)
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => ChatScreen(
                          personaName: persona.name,
                          personaAsset: persona.asset,
                          accentColor: persona.accentColor,
                        ),
                      ),
                    );
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: persona.accentColor,
                    foregroundColor: Colors.black,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: const Text(
                    '선택하기',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
