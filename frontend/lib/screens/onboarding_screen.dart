import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../services/app_storage.dart';
import 'login_screen.dart';

/// 최초 실행 1회 표시되는 온보딩.
/// 마지막 페이지의 "시작하기" 또는 우상단 "건너뛰기" → LoginScreen으로 이동
/// 하면서 markOnboardingDone() 호출. 다음 실행부터는 스플래시가 바로 분기.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _pageController = PageController();
  int _page = 0;

  static final _pages = <_OnboardingPage>[
    const _OnboardingPage(
      title: 'EmotiPlace에 오신 걸 환영해요',
      body: 'AI 페르소나와 편하게 대화하면\n지금의 감정에 어울리는 장소를 찾아드려요.',
      kind: _PageKind.welcome,
    ),
    _OnboardingPage(
      title: '대화 상대를 골라보세요',
      body: '의리 있는 조폭 동생, 냉철한 논리 로봇,\n푸근한 욕쟁이 할멈 — 마음 가는 페르소나와 이야기하세요.',
      kind: _PageKind.personas,
    ),
    const _OnboardingPage(
      title: '대화하다 보면 자연스럽게',
      // {pin} 자리에 위치-핀 아이콘이 인라인으로 들어간다 (_buildBody 참조).
      body: '충분히 대화하면 어울리는 장소를 추천해드려요.\n원할 땐 언제든 우측 상단의 {pin} 아이콘으로\n바로 추천 받을 수도 있어요.',
      kind: _PageKind.recommend,
    ),
  ];

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  bool get _isLast => _page == _pages.length - 1;

  Future<void> _finish() async {
    await AppStorage.markOnboardingDone();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  void _goNext() {
    if (_isLast) {
      _finish();
      return;
    }
    _pageController.animateToPage(
      _page + 1,
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    const accent = Color(0xFFFF6B35);
    return Scaffold(
      backgroundColor: const Color(0xFF121212),
      body: SafeArea(
        child: Column(
          children: [
            // 우상단 건너뛰기
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: _finish,
                child: const Text(
                  '건너뛰기',
                  style: TextStyle(color: Color(0xFF888888)),
                ),
              ),
            ),

            // 페이지 콘텐츠
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                itemCount: _pages.length,
                onPageChanged: (i) => setState(() => _page = i),
                itemBuilder: (_, i) => _OnboardingPageView(
                  page: _pages[i],
                  accent: accent,
                ),
              ),
            ),

            // 인디케이터
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(_pages.length, (i) {
                final active = i == _page;
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  width: active ? 22 : 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: active ? accent : const Color(0xFF555555),
                    borderRadius: BorderRadius.circular(4),
                  ),
                );
              }),
            ),
            const SizedBox(height: 24),

            // 다음 / 시작하기 버튼
            Padding(
              padding: const EdgeInsets.fromLTRB(32, 0, 32, 28),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _goNext,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: accent,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: Text(
                    _isLast ? '시작하기' : '다음',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

enum _PageKind { welcome, personas, recommend }

class _OnboardingPage {
  final String title;
  final String body;
  final _PageKind kind;
  const _OnboardingPage({
    required this.title,
    required this.body,
    required this.kind,
  });

  /// recommend 페이지 본문은 인라인 위치-핀 아이콘을 포함하므로 별도 처리.
  /// 다른 페이지는 단순 텍스트.
  bool get hasInlineIcon => kind == _PageKind.recommend;
}

class _OnboardingPageView extends StatelessWidget {
  final _OnboardingPage page;
  final Color accent;

  const _OnboardingPageView({required this.page, required this.accent});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 28),
      child: Column(
        children: [
          const SizedBox(height: 12),
          Expanded(
            flex: 5,
            child: Center(child: _buildVisual()),
          ),
          Expanded(
            flex: 3,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.start,
              children: [
                Text(
                  page.title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(height: 14),
                _buildBody(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// 본문 렌더링.
  /// recommend 페이지는 본문에 {pin} 토큰을 두고, 그 자리에 채팅 화면 AppBar와
  /// 똑같은 [Icons.place_outlined] 위젯을 인라인 삽입한다 — 두 아이콘 모양 일치 보장.
  Widget _buildBody() {
    const baseStyle = TextStyle(
      color: Color(0xFFBBBBBB),
      fontSize: 15,
      height: 1.6,
    );
    if (!page.hasInlineIcon) {
      return Text(page.body, style: baseStyle);
    }

    final parts = page.body.split('{pin}');
    final spans = <InlineSpan>[];
    for (var i = 0; i < parts.length; i++) {
      spans.add(TextSpan(text: parts[i]));
      if (i < parts.length - 1) {
        spans.add(WidgetSpan(
          alignment: PlaceholderAlignment.middle,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: Icon(Icons.place_outlined, size: 18, color: accent),
          ),
        ));
      }
    }
    return Text.rich(TextSpan(style: baseStyle, children: spans));
  }

  Widget _buildVisual() {
    switch (page.kind) {
      case _PageKind.welcome:
        return _buildWelcomeVisual();
      case _PageKind.personas:
        return _buildPersonasVisual();
      case _PageKind.recommend:
        return _buildRecommendVisual();
    }
  }

  Widget _buildWelcomeVisual() {
    return RichText(
      text: const TextSpan(
        children: [
          TextSpan(
            text: 'Emoti',
            style: TextStyle(
              fontSize: 48,
              fontWeight: FontWeight.w800,
              color: Color(0xFFFF6B35),
              letterSpacing: -0.5,
            ),
          ),
          TextSpan(
            text: 'Place',
            style: TextStyle(
              fontSize: 48,
              fontWeight: FontWeight.w300,
              color: Color(0xFFCCCCCC),
              letterSpacing: -0.5,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPersonasVisual() {
    const assets = [
      'assets/images/persona_mob_brother.svg',
      'assets/images/persona_logic_robot.svg',
      'assets/images/persona_granny.svg',
    ];
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        for (final a in assets)
          Flexible(
            child: AspectRatio(
              aspectRatio: 1,
              child: SvgPicture.asset(a, fit: BoxFit.contain),
            ),
          ),
      ],
    );
  }

  Widget _buildRecommendVisual() {
    return Stack(
      alignment: Alignment.center,
      children: [
        // 채팅 말풍선 느낌의 큰 카드
        Container(
          width: 220,
          decoration: BoxDecoration(
            color: const Color(0xFF1E1E1E),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: accent.withValues(alpha: 0.35)),
          ),
          padding: const EdgeInsets.all(14),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    '대화 중...',
                    style: TextStyle(color: Color(0xFFAAAAAA), fontSize: 12),
                  ),
                  // 실제 채팅 화면 AppBar의 추천 버튼과 동일한 아이콘.
                  Icon(Icons.place_outlined, color: accent, size: 24),
                ],
              ),
              const SizedBox(height: 12),
              _buildBubble('오늘 좀 지치네요', isUser: true),
              const SizedBox(height: 6),
              _buildBubble('아가, 천천히 들어볼테니 풀어놔봐', isUser: false),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildBubble(String text, {required bool isUser}) {
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: isUser
              ? accent.withValues(alpha: 0.25)
              : const Color(0xFF2A2A2A),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          text,
          style: const TextStyle(color: Colors.white, fontSize: 11),
        ),
      ),
    );
  }
}
