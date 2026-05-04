import 'package:flutter/material.dart';
import '../services/auth_service.dart';
import '../services/api_client.dart';

class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _emailController = TextEditingController();
  final _nicknameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _passwordConfirmController = TextEditingController();
  bool _obscurePassword = true;
  bool _obscureConfirm = true;
  bool _loading = false;

  // MBTI 4축. null = 미선택. 4축 모두 선택돼야 백엔드에 보냄.
  // 각 축의 첫 글자가 0번 인덱스, 두 번째 글자가 1번 인덱스.
  static const _axes = [
    [_MbtiOption('E', '외향', '사람과 어울려 에너지를 얻어요'),
     _MbtiOption('I', '내향', '혼자만의 시간으로 충전해요')],
    [_MbtiOption('S', '감각', '실제 경험과 사실에 집중해요'),
     _MbtiOption('N', '직관', '의미와 가능성에 끌려요')],
    [_MbtiOption('T', '사고', '논리와 객관에 따라 판단해요'),
     _MbtiOption('F', '감정', '감정과 관계를 우선해요')],
    [_MbtiOption('J', '판단', '계획적이고 정돈된 걸 좋아해요'),
     _MbtiOption('P', '인식', '유연하고 즉흥적인 걸 좋아해요')],
  ];
  // 각 축별로 선택된 인덱스 (0/1) 또는 null
  final List<int?> _mbtiSelections = [null, null, null, null];
  final _mbtiPageController = PageController();
  int _mbtiPage = 0;

  String? get _mbtiCode {
    if (_mbtiSelections.any((s) => s == null)) return null;
    return List.generate(4, (i) => _axes[i][_mbtiSelections[i]!].letter).join();
  }

  void _gotoMbtiPage(int page) {
    final clamped = page.clamp(0, _axes.length - 1);
    _mbtiPageController.animateToPage(
      clamped,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOut,
    );
  }

  @override
  void dispose() {
    _emailController.dispose();
    _nicknameController.dispose();
    _passwordController.dispose();
    _passwordConfirmController.dispose();
    _mbtiPageController.dispose();
    super.dispose();
  }

  Future<void> _signup() async {
    final email = _emailController.text.trim();
    final nickname = _nicknameController.text.trim();
    final password = _passwordController.text;
    final passwordConfirm = _passwordConfirmController.text;

    if (email.isEmpty || nickname.isEmpty || password.isEmpty) {
      _showError('모든 항목을 입력해주세요.');
      return;
    }
    if (password != passwordConfirm) {
      _showError('비밀번호가 일치하지 않습니다.');
      return;
    }

    setState(() => _loading = true);
    try {
      await AuthService.signup(
        email: email,
        nickname: nickname,
        password: password,
        mbti: _mbtiCode, // 4축 모두 선택돼야 전송, 아니면 null
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('회원가입이 완료되었습니다.'),
          backgroundColor: Color(0xFF333333),
        ),
      );
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      _showError(e.message);
    } catch (_) {
      _showError('서버에 연결할 수 없습니다.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: const Color(0xFF333333)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF121212),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  '회원가입',
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 40),

                // 이메일
                TextField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  style: const TextStyle(color: Colors.white),
                  decoration: _inputDecoration(
                    hint: '이메일',
                    icon: Icons.email_outlined,
                  ),
                ),
                const SizedBox(height: 16),

                // 닉네임
                TextField(
                  controller: _nicknameController,
                  style: const TextStyle(color: Colors.white),
                  decoration: _inputDecoration(
                    hint: '닉네임',
                    icon: Icons.badge_outlined,
                  ),
                ),
                const SizedBox(height: 16),

                // 비밀번호
                TextField(
                  controller: _passwordController,
                  obscureText: _obscurePassword,
                  style: const TextStyle(color: Colors.white),
                  decoration: _inputDecoration(
                    hint: '비밀번호',
                    icon: Icons.lock_outline,
                    suffixIcon: IconButton(
                      icon: Icon(
                        _obscurePassword ? Icons.visibility_off : Icons.visibility,
                        color: const Color(0xFF666666),
                      ),
                      onPressed: () {
                        setState(() => _obscurePassword = !_obscurePassword);
                      },
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // 비밀번호 확인
                TextField(
                  controller: _passwordConfirmController,
                  obscureText: _obscureConfirm,
                  style: const TextStyle(color: Colors.white),
                  decoration: _inputDecoration(
                    hint: '비밀번호 확인',
                    icon: Icons.lock_outline,
                    suffixIcon: IconButton(
                      icon: Icon(
                        _obscureConfirm ? Icons.visibility_off : Icons.visibility,
                        color: const Color(0xFF666666),
                      ),
                      onPressed: () {
                        setState(() => _obscureConfirm = !_obscureConfirm);
                      },
                    ),
                  ),
                ),
                const SizedBox(height: 28),

                // MBTI (선택)
                _buildMbtiSection(),
                const SizedBox(height: 28),

                // 가입 버튼
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _loading ? null : _signup,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFFF6B35),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    child: _loading
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text(
                            '가입하기',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildMbtiSection() {
    const accent = Color(0xFFFF6B35);
    const cardBg = Color(0xFF1E1E1E);
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF2A2A2A)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.psychology_outlined, size: 18, color: accent),
              const SizedBox(width: 6),
              const Text(
                'MBTI',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                _mbtiCode ?? '선택 안 함',
                style: TextStyle(
                  color: _mbtiCode != null ? accent : const Color(0xFF888888),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const Spacer(),
              const Text(
                '(선택)',
                style: TextStyle(color: Color(0xFF666666), fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 160,
            child: Stack(
              alignment: Alignment.center,
              children: [
                PageView.builder(
                  controller: _mbtiPageController,
                  itemCount: _axes.length,
                  onPageChanged: (i) => setState(() => _mbtiPage = i),
                  itemBuilder: (_, axisIndex) {
                    final pair = _axes[axisIndex];
                    final selected = _mbtiSelections[axisIndex];
                    return Row(
                      children: [
                        Expanded(
                          child: _MbtiOptionCard(
                            option: pair[0],
                            isSelected: selected == 0,
                            accent: accent,
                            onTap: () => setState(() {
                              _mbtiSelections[axisIndex] = selected == 0 ? null : 0;
                            }),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _MbtiOptionCard(
                            option: pair[1],
                            isSelected: selected == 1,
                            accent: accent,
                            onTap: () => setState(() {
                              _mbtiSelections[axisIndex] = selected == 1 ? null : 1;
                            }),
                          ),
                        ),
                      ],
                    );
                  },
                ),
                Positioned(
                  left: -8,
                  child: IconButton(
                    icon: const Icon(Icons.chevron_left, color: Color(0xFFAAAAAA)),
                    onPressed: _mbtiPage > 0
                        ? () => _gotoMbtiPage(_mbtiPage - 1)
                        : null,
                  ),
                ),
                Positioned(
                  right: -8,
                  child: IconButton(
                    icon: const Icon(Icons.chevron_right, color: Color(0xFFAAAAAA)),
                    onPressed: _mbtiPage < _axes.length - 1
                        ? () => _gotoMbtiPage(_mbtiPage + 1)
                        : null,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(_axes.length, (i) {
              final active = i == _mbtiPage;
              return Container(
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: active ? 16 : 6,
                height: 6,
                decoration: BoxDecoration(
                  color: active ? accent : const Color(0xFF555555),
                  borderRadius: BorderRadius.circular(3),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  InputDecoration _inputDecoration({
    required String hint,
    required IconData icon,
    Widget? suffixIcon,
  }) {
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: Color(0xFF666666)),
      prefixIcon: Icon(icon, color: const Color(0xFF666666)),
      suffixIcon: suffixIcon,
      filled: true,
      fillColor: const Color(0xFF1E1E1E),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFFF6B35), width: 1.5),
      ),
    );
  }
}

class _MbtiOption {
  final String letter;   // E/I/S/N/T/F/J/P
  final String label;    // 한국어 라벨
  final String hint;     // 1줄 설명
  const _MbtiOption(this.letter, this.label, this.hint);
}

class _MbtiOptionCard extends StatelessWidget {
  final _MbtiOption option;
  final bool isSelected;
  final Color accent;
  final VoidCallback onTap;

  const _MbtiOptionCard({
    required this.option,
    required this.isSelected,
    required this.accent,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
        decoration: BoxDecoration(
          color: isSelected ? accent.withValues(alpha: 0.16) : const Color(0xFF252525),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? accent : const Color(0xFF333333),
            width: isSelected ? 1.6 : 1,
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              option.letter,
              style: TextStyle(
                color: isSelected ? accent : Colors.white,
                fontSize: 28,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              option.label,
              style: TextStyle(
                color: isSelected ? accent : const Color(0xFFCCCCCC),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              option.hint,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFF888888),
                fontSize: 11,
                height: 1.3,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

