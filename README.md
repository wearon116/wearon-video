# WEARON VIDEO PRO

데모 HTML이 아니라 Vercel에 바로 배포할 수 있는 Next.js 프로젝트입니다.

## 현재 실제로 동작하는 기능
- YouTube URL 공개 정보 조회(oEmbed, API 키가 있으면 통계까지)
- YouTube Data API v3 기반 대한민국 실시간 인기 영상 목록
- 인기 목록 5분 주기 자동 갱신
- 사용자가 소유/허가받은 로컬 영상 파일 업로드
- 업로드 영상 미리보기
- 15초 단위 쇼츠 후보 생성 흐름
- 브라우저 Canvas + MediaRecorder 기반 9:16 중앙 크롭
- WEARON VIDEO 오버레이 적용
- WebM 실제 파일 렌더링/다운로드
- 프로젝트 localStorage 저장
- 템플릿, 채널 연동, 요금제 UI

## 중요
YouTube URL의 영상을 임의로 다운로드해 재가공하는 코드는 포함하지 않았습니다.
URL은 메타데이터/트렌드 조회에 쓰고, 실제 쇼츠 생성은 사용자가 권리를 가진 원본 파일 업로드 방식입니다.

## YouTube 실시간 인기 연결
Google Cloud Console에서 YouTube Data API v3를 활성화하고 API 키를 만든 뒤 Vercel 환경 변수에:

YOUTUBE_API_KEY=발급받은키

를 추가하고 재배포하면 됩니다.

## 로컬 실행
1. Node.js 20 이상 설치
2. 이 폴더에서 `npm install`
3. `.env.example`을 `.env.local`로 복사 후 키 입력
4. `npm run dev`
5. http://localhost:3000

## Vercel 배포
프로젝트를 Vercel에 Import하거나 Vercel 연결 도구를 사용해 배포하세요.
환경 변수 YOUTUBE_API_KEY를 Production/Preview에 설정하면 됩니다.

## 커스텀 도메인
Vercel 프로젝트 > Settings > Domains에서 구매한 도메인을 연결할 수 있습니다.

## 다음 백엔드 확장
자동 STT, 진짜 하이라이트 분석, 얼굴 추적 리프레임, 서버 MP4 렌더링을 안정적으로 제공하려면
별도 영상 처리 워커(Railway/Render 등) + FFmpeg + 오브젝트 스토리지가 적합합니다.
