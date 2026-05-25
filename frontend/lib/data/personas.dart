import 'package:flutter/material.dart';

class PersonaInfo {
  final int personaId;
  final String name;
  final String description;
  final String asset;
  final Color accentColor;
  final Color bgColor;

  const PersonaInfo({
    required this.personaId,
    required this.name,
    required this.description,
    required this.asset,
    required this.accentColor,
    required this.bgColor,
  });
}

const List<PersonaInfo> kPersonas = [
  PersonaInfo(
    personaId: 1,
    name: '의리 있는 조폭 동생',
    description: '행님 한번만 믿어보십쇼! 의리 하나로 끝까지 모시겠습니다. 거친 세상, 제가 옆에서 든든하게 지켜드리겠습니다.',
    asset: 'assets/images/persona_mob_brother.svg',
    accentColor: Color(0xFFC8A020),
    bgColor: Color(0xFF1A0E06),
  ),
  PersonaInfo(
    personaId: 2,
    name: '냉철한 논리 로봇',
    description: '당신 감정, 데이터화. 분석 개시. 최적 변수 추출. 장소 연산. 결과 도출. 오류 없음.',
    asset: 'assets/images/persona_logic_robot.svg',
    accentColor: Color(0xFF00E5FF),
    bgColor: Color(0xFF050F1A),
  ),
  PersonaInfo(
    personaId: 3,
    name: '푸근한 욕쟁이 할멈',
    description: '아이고 아가, 힘든 일 있으믄 할미한테 다 털어나. 할미가 좋은 데 알아서 보내줄께.',
    asset: 'assets/images/persona_granny.svg',
    accentColor: Color(0xFFE8762A),
    bgColor: Color(0xFF1A0C04),
  ),
];

PersonaInfo personaById(int personaId) {
  return kPersonas.firstWhere(
    (p) => p.personaId == personaId,
    orElse: () => kPersonas[0],
  );
}
