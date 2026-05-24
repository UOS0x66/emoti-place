#!/usr/bin/env bash
# 서울 빠진 18개 구 일괄 수집 (강남~은평 + 서대문)
set -e
SIGUNGU_LIST=(1 2 3 4 5 7 8 9 10 12 13 14 15 18 19 20 21 22)
TOTAL=${#SIGUNGU_LIST[@]}
i=0
for code in "${SIGUNGU_LIST[@]}"; do
  i=$((i+1))
  echo ""
  echo "======== [$i/$TOTAL] sigungu=$code ========"
  node scripts/etl/collect.js --sigungu=$code
done
echo ""
echo "======== 전체 완료 ($TOTAL개 구) ========"
