import "./globals.css";

export const metadata = {
  title: "WEARON VIDEO — AI Shorts Studio",
  description: "유튜브 트렌드 탐색과 숏폼 제작을 위한 WEARON VIDEO",
  icons: {
    icon: "/images/%EC%82%BC%EC%83%89%20%EC%98%81%EC%83%81%20%ED%8C%A8%EB%84%90%20W%20%EB%A1%9C%EA%B3%A0.png",
    shortcut: "/images/%EC%82%BC%EC%83%89%20%EC%98%81%EC%83%81%20%ED%8C%A8%EB%84%90%20W%20%EB%A1%9C%EA%B3%A0.png",
    apple: "/images/%EC%82%BC%EC%83%89%20%EC%98%81%EC%83%81%20%ED%8C%A8%EB%84%90%20W%20%EB%A1%9C%EA%B3%A0.png"
  }
};

export default function RootLayout({ children }) {
  return <html lang="ko"><body>{children}</body></html>;
}
