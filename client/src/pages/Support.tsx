import { useEffect } from "react";
import { ArrowLeft, MessageCircle, HelpCircle, FileText, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ_ITEMS: { q: string; a: string[] }[] = [
  {
    q: "パートナーと記録を共有するには？",
    a: [
      "We育では「家族ID」を使ってパートナーと記録を共有します。",
      "はじめに登録した方の設定画面に表示される家族IDをパートナーに伝え、パートナーが初期設定で同じ家族IDを入力すると、ふたりの記録が自動で同期されます。",
    ],
  },
  {
    q: "ログインできません",
    a: [
      "We育はLINEアカウントでログインします。LINEアプリ内ブラウザまたはSafari/Chromeなどのブラウザからアクセスし、「LINEでログイン」をお試しください。",
      "うまくいかない場合は、一度ブラウザを閉じてから we-iku.com に再度アクセスしてください。それでも解決しない場合はお問い合わせください。",
    ],
  },
  {
    q: "記録を間違えたので修正・削除したい",
    a: [
      "画面下の「きろく」タブを開くと、その日の記録が時系列で表示されます。",
      "記録をタップすると、時刻の変更や削除ができます。",
    ],
  },
  {
    q: "過去の日付の記録を追加したい",
    a: [
      "「きろく」タブで上部の日付を過去の日に切り替えてから、右下の「＋」ボタンで記録すると、その日の記録として追加できます。",
    ],
  },
  {
    q: "機種変更・別の端末で使うには？",
    a: [
      "新しい端末で we-iku.com にアクセスし、同じLINEアカウントでログインすると、これまでの記録がそのまま引き継がれます。",
    ],
  },
  {
    q: "授乳アラーム（通知）が届きません",
    a: [
      "設定画面の「授乳アラーム」がオンになっているかご確認ください。",
      "はじめてオンにするときに表示される「通知の許可」で「許可」を選ぶ必要があります。ブラウザやスマートフォンの設定で通知がオフになっている場合は、オンに変更してください。",
    ],
  },
  {
    q: "育児日記を自分だけが見られるようにしたい",
    a: [
      "育児日記の作成・編集画面で公開範囲を「自分だけ」にすると、その日記はパートナーには一切表示されません。",
      "「共有」にすると、パートナーも見られるようになります。",
    ],
  },
  {
    q: "子どもは複数登録できますか？",
    a: [
      "はい、複数のお子さまを登録できます。設定画面からお子さまを追加し、ホーム画面のスイッチャーで切り替えて記録できます。",
      "記録ボタンはお子さまの年齢に合わせて自動で切り替わります。",
    ],
  },
  {
    q: "料金はかかりますか？",
    a: [
      "現在は先着50名様限定のモニタープランとしてご提供しており、対象の方はお子さまが6歳になるまですべての機能を無料でご利用いただけます。",
      "詳しくは利用規約をご覧ください。",
    ],
  },
  {
    q: "データを削除したい・退会したい",
    a: [
      "アカウントとデータの削除をご希望の場合は、LINE公式アカウント（@we-iku）までご連絡ください。確認のうえ、登録情報と記録データを削除いたします。",
    ],
  },
];

export default function Support() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "サポート | We育（ウィーイク）";
    return () => {
      document.title = prevTitle;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 via-white to-green-50 pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="rounded-full" data-testid="button-back-settings">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-black text-purple-800" data-testid="text-support-title">
            サポート
          </h1>
        </div>

        <div className="bg-white rounded-[24px] p-6 shadow-sm border border-gray-100 mb-4">
          <h2 className="text-lg font-black text-purple-900 mb-1">We育（ウィーイク）</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            We育はパートナーと一緒に育児を記録・共有できるアプリです。
            お困りのことがあれば、まずは下記のよくある質問をご覧ください。
            解決しない場合はお気軽にお問い合わせください。
          </p>
        </div>

        <div className="bg-white rounded-[24px] p-6 shadow-sm border border-gray-100 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle className="w-5 h-5 text-purple-500" />
            <h2 className="text-base font-black text-purple-800">よくある質問</h2>
          </div>
          <Accordion type="single" collapsible className="w-full">
            {FAQ_ITEMS.map((item, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger
                  className="text-sm font-bold text-gray-700 text-left"
                  data-testid={`accordion-faq-${i}`}
                >
                  {item.q}
                </AccordionTrigger>
                <AccordionContent>
                  {item.a.map((p, j) => (
                    <p key={j} className="text-sm text-gray-600 leading-relaxed mb-2">
                      {p}
                    </p>
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        <div className="bg-white rounded-[24px] p-6 shadow-sm border border-gray-100 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageCircle className="w-5 h-5 text-green-600" />
            <h2 className="text-base font-black text-purple-800">お問い合わせ</h2>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            よくある質問で解決しない場合は、LINE公式アカウントまでお気軽にご連絡ください。
          </p>
          <div className="bg-green-50 rounded-2xl p-4 border border-green-100 text-sm text-gray-700 leading-relaxed space-y-1" data-testid="text-contact-info">
            <p>事業者名：株式会社Grape</p>
            <p>サービス名：We育（ウィーイク）</p>
            <p>お問い合わせ方法：LINE公式アカウント @we-iku</p>
          </div>
        </div>

        <Link href="/legal">
          <div
            className="flex items-center justify-between bg-white rounded-[24px] p-4 shadow-sm border border-gray-100 cursor-pointer"
            data-testid="link-support-legal"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                <FileText className="w-5 h-5 text-gray-500" />
              </div>
              <p className="text-sm font-bold text-gray-700">プライバシーポリシー・利用規約</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </div>
        </Link>
      </div>
    </div>
  );
}
