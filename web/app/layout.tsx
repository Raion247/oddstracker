import type { Metadata } from "next";
import NavigationBar from "@/C/NavigationBar";
import "./globals.css"; // "error fix: add compilerOptions": {"noUncheckedSideEffectImports": false, } in tsconfig.json

export const metadata: Metadata = {
  title: "OddsTracker",
  description: "The highest winning odds of every analyzed match",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NavigationBar />
        <main className="mx-auto max-w-[1100px] px-6 pt-8 pb-16">{children}</main>
      </body>
    </html>
  );
}
