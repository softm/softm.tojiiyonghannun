/** SOFTM-ADFIT 토지이용한눈 전용 설정.
 * 공통 기준: softm.github.io/ADFIT-COMMON-ADS.md
 * 동일 광고 단위를 여러 지면에 재사용하지 않는다.
 * 새 PC 728x90/하단 접이식 광고는 전용 단위 발급 전까지 생성하지 않는다.
 */
globalThis.TOJI_IYONG_AD_CONFIG = Object.freeze({
  enabled: true,
  domain: "tojiiyonghannun.designboard.net",
  script: "https://t1.kakaocdn.net/kas/static/ba.min.js",
  placements: Object.freeze({
    searchResults: Object.freeze({unit: "DAN-4nmORIg1At492nrf", width: 320, height: 100}),
    parcelDetail: Object.freeze({unit: "DAN-71yamqyQ7AV0rxk2", width: 320, height: 100}),
    bottomMobile: Object.freeze({unit: "DAN-b4E6afJ77CoU1PDr", width: 320, height: 50}),
    bottomDesktop: Object.freeze({unit: "DAN-qqDZXJ1WNQkVFw6o", width: 728, height: 90})
  })
});
