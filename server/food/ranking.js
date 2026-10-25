// 맛집 점수 (한끼 최저가 앱 kts4u1/Restaurant 의 public/ranking.js 에서 가져옴)
// 리뷰가 적은 곳의 평점은 전체 평균(3.6) 쪽으로 당겨서 본다 (리뷰 2개짜리 5.0 이 앞서지 않게)
export const PRIOR_SCORE = 3.6;
const PRIOR_WEIGHT = 8;

/** 맛집 점수: 평점(리뷰 수 반영) + 인기(리뷰·블로그 수) + "맛" 추천 비율 */
export function qualityScore(rating) {
  if (!rating || (!rating.count && !rating.blog)) return null;
  const n = rating.count || 0;
  const avg = rating.score ?? PRIOR_SCORE;
  const bayes = (PRIOR_SCORE * PRIOR_WEIGHT + avg * n) / (PRIOR_WEIGHT + n);
  const popularity = Math.log10(1 + n + (rating.blog || 0) / 3); // 0 ~ 약 3
  const taste = n ? Math.min(1, (rating.taste || 0) / n) : 0;
  return bayes + 0.12 * popularity + 0.25 * taste;
}

/** "맛집" 표시: 리뷰 10개 이상이고 점수가 높은 곳 */
export function isTasty(rating) {
  const q = qualityScore(rating);
  return q != null && (rating.count || 0) >= 10 && q >= 4.1;
}

/** 추천 목록에 넣을 최소 점수 (평균보다 나은 곳) */
export const RECOMMEND_MIN_SCORE = 3.85;
