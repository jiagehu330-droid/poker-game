import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "口袋牌局 · 好友德州扑克",
  description: "创建私人好友房，邀请朋友或添加人机，随时开一桌。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
