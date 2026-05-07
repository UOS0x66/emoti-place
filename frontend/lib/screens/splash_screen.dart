import 'package:flutter/material.dart';
import '../services/app_storage.dart';
import '../services/auth_storage.dart';
import 'login_screen.dart';
import 'onboarding_screen.dart';
import 'persona_selection_screen.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _fadeAnimation;
  late Animation<double> _scaleAnimation;
  late Animation<double> _subtitleFade;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    );

    _fadeAnimation = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.0, 0.6, curve: Curves.easeIn),
    );

    _scaleAnimation = Tween<double>(begin: 0.85, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.0, 0.6, curve: Curves.easeOut),
      ),
    );

    _subtitleFade = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.4, 0.9, curve: Curves.easeIn),
    );

    _controller.forward();

    _navigateAfterDelay();
  }

  Future<void> _navigateAfterDelay() async {
    // 스플래시 애니메이션 + 토큰/온보딩 상태를 병렬로 조회.
    // getValidToken은 만료 토큰을 자동 정리하고 null을 반환한다.
    final results = await Future.wait([
      Future.delayed(const Duration(seconds: 3)),
      AuthStorage.getValidToken(),
      AppStorage.isOnboardingDone(),
    ]);
    if (!mounted) return;

    final token = results[1] as String?;
    final onboardingDone = results[2] as bool;

    // 라우팅 우선순위:
    //   1) 온보딩을 아직 안 봤으면 무조건 온보딩으로 (1회성).
    //   2) 유효 토큰 있으면 자동 로그인 → 페르소나 선택.
    //   3) 아니면 로그인 화면.
    final Widget next;
    if (!onboardingDone) {
      next = const OnboardingScreen();
    } else if (token != null && token.isNotEmpty) {
      next = const PersonaSelectionScreen();
    } else {
      next = const LoginScreen();
    }

    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => next),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Color(0xFFFFF0E6),
              Color(0xFFFFE4CC),
              Color(0xFFFFD6B8),
            ],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // 앱 이름
                      FadeTransition(
                        opacity: _fadeAnimation,
                        child: ScaleTransition(
                          scale: _scaleAnimation,
                          child: RichText(
                            text: const TextSpan(
                              children: [
                                TextSpan(
                                  text: 'Emoti',
                                  style: TextStyle(
                                    fontSize: 38,
                                    fontWeight: FontWeight.w800,
                                    color: Color(0xFFFF6B35),
                                    letterSpacing: -0.5,
                                  ),
                                ),
                                TextSpan(
                                  text: 'Place',
                                  style: TextStyle(
                                    fontSize: 38,
                                    fontWeight: FontWeight.w300,
                                    color: Color(0xFF5C3D2E),
                                    letterSpacing: -0.5,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),

                      // 슬로건
                      FadeTransition(
                        opacity: _subtitleFade,
                        child: const Text(
                          '지금 내 감정에 딱 맞는 장소',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w400,
                            color: Color(0xFF8B6E5A),
                            letterSpacing: 0.3,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // 하단 로딩 인디케이터
              FadeTransition(
                opacity: _subtitleFade,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 48),
                  child: SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.5,
                      color: const Color(0xFFFF6B35).withValues(alpha: 0.7),
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
