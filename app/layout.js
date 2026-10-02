import "./globals.css";

export const metadata = {
  title: "WEARON VIDEO — AI Shorts Studio",
  description: "유튜브 트렌드 탐색과 숏폼 제작을 위한 WEARON VIDEO"
};

export default function RootLayout({ children }) {
  return <html lang="ko"><body>{children}</body></html>;
}
