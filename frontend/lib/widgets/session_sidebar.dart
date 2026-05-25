import 'package:flutter/material.dart';
import '../data/personas.dart';
import '../services/session_service.dart';

class SessionSidebar extends StatefulWidget {
  final String currentSessionId;
  final VoidCallback onNewSession;
  final Function(String sessionId) onSelectSession;
  // 삭제 후 현재 세션이 사라졌을 때 부모가 화면을 어떻게 다룰지 결정한다.
  final Function(String sessionId)? onSessionDeleted;

  const SessionSidebar({
    super.key,
    required this.currentSessionId,
    required this.onNewSession,
    required this.onSelectSession,
    this.onSessionDeleted,
  });

  @override
  State<SessionSidebar> createState() => _SessionSidebarState();
}

class _SessionSidebarState extends State<SessionSidebar> {
  late Future<List<SessionInfo>> _sessionsFuture;

  @override
  void initState() {
    super.initState();
    _loadSessions();
  }

  void _loadSessions() {
    _sessionsFuture = SessionService.listSessions();
  }

  Future<void> _refresh() async {
    setState(_loadSessions);
    await _sessionsFuture;
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = today.subtract(const Duration(days: 1));
    final dateOnly = DateTime(date.year, date.month, date.day);

    if (dateOnly == today) {
      final hh = date.hour.toString().padLeft(2, '0');
      final mm = date.minute.toString().padLeft(2, '0');
      return '$hh:$mm';
    } else if (dateOnly == yesterday) {
      return '어제';
    } else if (now.difference(dateOnly).inDays < 7) {
      const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
      return weekdays[date.weekday - 1];
    } else {
      return '${date.month}월 ${date.day}일';
    }
  }

  String _getPersonaName(int personaId) => personaById(personaId).name;

  Future<void> _handleDelete(SessionInfo session) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E1E),
        title: const Text('대화 삭제', style: TextStyle(color: Colors.white)),
        content: Text(
          '"${session.title ?? '(제목 없음)'}" 대화를 삭제하시겠습니까?\n삭제된 대화는 복구할 수 없습니다.',
          style: const TextStyle(color: Color(0xFFCCCCCC)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('취소', style: TextStyle(color: Color(0xFF999999))),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('삭제', style: TextStyle(color: Color(0xFFFF6B35))),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await SessionService.deleteSession(session.sessionId);
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(
          content: Text('대화를 삭제했습니다.'),
          backgroundColor: Color(0xFF333333),
        ),
      );
      await _refresh();
      if (session.sessionId == widget.currentSessionId &&
          widget.onSessionDeleted != null) {
        widget.onSessionDeleted!(session.sessionId);
      }
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text('삭제 실패: $e'),
          backgroundColor: const Color(0xFF333333),
        ),
      );
    }
  }

  Future<void> _handleRename(SessionInfo session) async {
    final controller = TextEditingController(text: session.title ?? '');
    final newTitle = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E1E),
        title: const Text('제목 수정', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 100,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(
            hintText: '새 제목을 입력하세요',
            hintStyle: TextStyle(color: Color(0xFF666666)),
            counterStyle: TextStyle(color: Color(0xFF666666)),
            enabledBorder: UnderlineInputBorder(
              borderSide: BorderSide(color: Color(0xFF444444)),
            ),
            focusedBorder: UnderlineInputBorder(
              borderSide: BorderSide(color: Color(0xFF00E5FF)),
            ),
          ),
          onSubmitted: (v) => Navigator.of(ctx).pop(v.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('취소', style: TextStyle(color: Color(0xFF999999))),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
            child: const Text('저장', style: TextStyle(color: Color(0xFF00E5FF))),
          ),
        ],
      ),
    );
    if (newTitle == null || newTitle.isEmpty) return;
    if (newTitle == (session.title ?? '')) return;
    if (!mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await SessionService.renameSession(session.sessionId, newTitle);
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(
          content: Text('제목을 수정했습니다.'),
          backgroundColor: Color(0xFF333333),
        ),
      );
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text('제목 수정 실패: $e'),
          backgroundColor: const Color(0xFF333333),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: const Color(0xFF1E1E1E),
      child: Column(
        children: [
          // 헤더
          Container(
            padding: const EdgeInsets.fromLTRB(16, 24, 16, 16),
            color: const Color(0xFF121212),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      '대화 목록',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () {
                      Navigator.of(context).pop();
                      widget.onNewSession();
                    },
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('+ 새 대화 시작'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF2A2A2A),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          // 세션 목록
          Expanded(
            child: RefreshIndicator(
              onRefresh: _refresh,
              color: const Color(0xFF00E5FF),
              backgroundColor: const Color(0xFF1E1E1E),
              child: FutureBuilder<List<SessionInfo>>(
                future: _sessionsFuture,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(
                      child: CircularProgressIndicator(color: Color(0xFF00E5FF)),
                    );
                  }

                  if (snapshot.hasError) {
                    return ListView(
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Text(
                            '대화 목록을 불러올 수 없습니다.',
                            style: TextStyle(
                              color: Colors.grey[400],
                              fontSize: 14,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ],
                    );
                  }

                  final sessions = snapshot.data ?? [];

                  if (sessions.isEmpty) {
                    return ListView(
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Text(
                            '저장된 대화가 없습니다.',
                            style: TextStyle(
                              color: Colors.grey[400],
                              fontSize: 14,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ],
                    );
                  }

                  return ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: sessions.length,
                    itemBuilder: (context, index) {
                      final session = sessions[index];
                      final isSelected = session.sessionId == widget.currentSessionId;

                      return ListTile(
                        title: Text(
                          session.title ?? '(제목 없음)',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: isSelected ? const Color(0xFF00E5FF) : Colors.white,
                            fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                            fontSize: 14,
                          ),
                        ),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const SizedBox(height: 4),
                            Text(
                              _getPersonaName(session.personaId),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Colors.grey[500],
                                fontSize: 12,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              _formatDate(session.createdAt),
                              style: TextStyle(
                                color: Colors.grey[600],
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ),
                        selected: isSelected,
                        selectedTileColor: const Color(0xFF00E5FF).withValues(alpha: 0.1),
                        onTap: isSelected
                            ? null
                            : () {
                                Navigator.of(context).pop();
                                widget.onSelectSession(session.sessionId);
                              },
                        trailing: PopupMenuButton<String>(
                          icon: Icon(Icons.more_vert, color: Colors.grey[500], size: 20),
                          color: const Color(0xFF2A2A2A),
                          onSelected: (value) {
                            if (value == 'rename') {
                              _handleRename(session);
                            } else if (value == 'delete') {
                              _handleDelete(session);
                            }
                          },
                          itemBuilder: (_) => const [
                            PopupMenuItem<String>(
                              value: 'rename',
                              child: Row(
                                children: [
                                  Icon(Icons.edit_outlined, size: 18, color: Colors.white70),
                                  SizedBox(width: 10),
                                  Text('제목 수정', style: TextStyle(color: Colors.white)),
                                ],
                              ),
                            ),
                            PopupMenuItem<String>(
                              value: 'delete',
                              child: Row(
                                children: [
                                  Icon(Icons.delete_outline, size: 18, color: Color(0xFFFF6B35)),
                                  SizedBox(width: 10),
                                  Text('삭제', style: TextStyle(color: Color(0xFFFF6B35))),
                                ],
                              ),
                            ),
                          ],
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}
