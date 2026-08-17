# We育 デモページ 移植パッケージ (`weiku-demo`)

既存の We育 (Replit) プロジェクトへ、デモページを**安全に追加**するための自己完結パッケージです。
公開先は `/demo` を想定しています（例: `https://we-iku.com/demo`）。

- ルート: `WeIkuDemoPage`（`components/weiku-demo/weiku-demo-page.tsx`）
- 画面切り替え（担当ママ↔パパ、カルーセル等）は**フロントエンドのみ**で動作します。
- **外部DB・認証・Vercel固有機能・Vercel Analytics は一切使用しません。**

---

## 1. 移植するファイル一覧（Replitへコピーするもの）

以下の 2 つのフォルダを、そのままプロジェクトへコピーしてください。**これ以外は不要です。**

### コンポーネント → `components/weiku-demo/`

```
components/weiku-demo/
├─ weiku-demo-page.tsx      ← エントリーポイント（export: WeIkuDemoPage）
├─ weiku-demo.css           ← デモ専用スコープ CSS（.weiku-demo 配下のみ）
├─ cn.ts                    ← clsx + tailwind-merge のヘルパー（自己完結）
├─ screens-data.ts          ← カルーセル用の画面データ
├─ site-nav.tsx
├─ site-footer.tsx
├─ hero.tsx
├─ core-value.tsx
├─ ai-prediction.tsx
├─ quick-log.tsx
├─ crying-rescue.tsx
├─ handoff.tsx
├─ invisible-childcare.tsx
├─ gratitude-rewards.tsx
├─ team-skills.tsx
├─ how-it-works.tsx
├─ testimonials.tsx
├─ story-stats.tsx
├─ comparison.tsx
├─ pricing.tsx
├─ final-cta.tsx
├─ phone-mockup.tsx
├─ screen-carousel.tsx
├─ reveal.tsx
├─ eyebrow.tsx
├─ info-tooltip.tsx
└─ README.md               ← このファイル
```

### 画像 → `public/weiku-demo/`

アプリからは `/weiku-demo/ファイル名` で参照します（ルート相対パス）。

```
public/weiku-demo/
├─ home-mama.png       (担当ママのホーム画面)
├─ home-papa.png       (担当パパのホーム画面)
├─ ai-predict.png      (AI予測)
├─ quicklog.png        (クイックログ)
├─ crying-rescue.png   (泣きやみレスキュー)
├─ invisible.png       (見えない育児の可視化)
├─ dashboard.png       (貢献度ダッシュボード)
├─ rewards.png         (ご褒美)
├─ thanks.png          (ありがとうカード)
├─ skills-lv1.png      (スキルレベル1)
└─ skills-lv2.png      (スキルレベル2)
```

### ルートページ（1ファイルだけ新規作成 / 追記）

`app/demo/page.tsx` を作成します（下記「3. ルート設定」参照）。

> **含めないもの:** `package.json` / `next.config.*` / `tsconfig.json` / `app/globals.css` /
> `app/layout.tsx` などプロジェクト全体の設定ファイルは移植パッケージに**含めません**。
> 既存プロジェクトのものをそのまま使います。

---

## 2. 必要な npm パッケージ

既存の We育 プロジェクトには通常すべて導入済みです。不足している場合のみ追加してください。

| パッケージ | 用途 | 目安バージョン |
|---|---|---|
| `next` | App Router（`app/demo`） | 14 以上（16 で確認） |
| `react` / `react-dom` | UI | 18 / 19 |
| `framer-motion` | スクロール表示アニメーション（`reveal.tsx` など） | 11 以上 |
| `lucide-react` | アイコン | 0.4x 以上 |
| `clsx` | クラス名結合（`cn.ts`） | 2 以上 |
| `tailwind-merge` | Tailwind クラスの競合解決（`cn.ts`） | 2 以上 |
| `tailwindcss` | スタイル（**v4 前提**） | 4 以上 |

インストール例:

```bash
npm install framer-motion lucide-react clsx tailwind-merge
```

> Tailwind は **v4（CSS ベース設定, `tailwind.config` なし）** を前提にしています。

---

## 3. ルート設定 (`app/demo/page.tsx`)

```tsx
import type { Metadata } from "next"
import { WeIkuDemoPage } from "@/components/weiku-demo/weiku-demo-page"

export const metadata: Metadata = {
  title: "We育｜育児を、ひとりの負担から、チームの営みへ。",
  description: "育児記録とAI予測で、家族のチーム育児を支えるWe育のサービスデモです。",
  alternates: { canonical: "/demo" },
}

export default function DemoPage() {
  return <WeIkuDemoPage />
}
```

- `/demo` と `/demo/`（末尾スラッシュ）は Next.js の既定で同一ページに正規化されます。
- `@/` エイリアスを使わない構成の場合は、相対パス（`../../components/weiku-demo/weiku-demo-page`）に置き換えてください。

---

## 4. デザイントークンについて（重要）

デモは既存 We育 サイトと同じブランド系ユーティリティ（`bg-grape` / `text-charcoal` /
`bg-lavender-pale` / `font-heading` など）を使用します。これらは Tailwind v4 の `@theme` で
定義されたカラートークンに依存します。

**既存の We育 プロジェクトでは `app/globals.css` に既に定義済み**のため、追加作業は不要です。

万一、トークン未定義の新規プロジェクトへ移植する場合は、ホストの `globals.css` の
`@theme` に以下を追加してください（既存の値は上書きしません）:

```css
@theme inline {
  --color-grape-deep: #5b2a86;
  --color-grape: #7b3fb2;
  --color-grape-light: #9b67c7;
  --color-lavender: #dcc8ee;
  --color-lavender-pale: #f6f0fa;
  --color-white-warm: #fcfafd;
  --color-charcoal: #25212b;
  --color-pink-soft: #f5b6d3;
  --color-mint: #a9e5d1;
  --color-blue-baby: #bcd7f5;
  --color-yellow-soft: #f6d98e;
}
```

日本語フォント（Zen Kaku Gothic New / Noto Sans JP）は `weiku-demo.css` が CSS から
直接読み込むため、`next/font` の設定に依存しません。

---

## 5. CSS のスコープ設計（既存サイトへの影響ゼロ）

- デモの全 UI は `WeIkuDemoPage` が出力する `<div class="weiku-demo">` の中だけに描画されます。
- `weiku-demo.css` のルールはすべて `.weiku-demo` 配下にネストされており、
  **グローバルセレクタ（`body`, `html`, `*` など）を単独では変更しません。**
- したがって、この CSS を読み込んでも既存サイトのスタイルを上書きすることはありません。

`weiku-demo.css` は `weiku-demo-page.tsx` の先頭で `import "./weiku-demo.css"` により
読み込まれるため、別途 `globals.css` へ追記する必要はありません。

---

## 6. 動作確認チェックリスト

- [ ] `/demo` にアクセスしてページが表示される
- [ ] `/demo/`（末尾スラッシュ）でも同じページが表示される
- [ ] 担当「ママ ↔ パパ」トグルで画面が切り替わる（リロード無し）
- [ ] 画像がすべて `/weiku-demo/...` から表示される（404 が出ない）
- [ ] トップページ `/` のデザインが変化していない（スタイル汚染が無い）
- [ ] スマホ幅・PC 幅の両方でレイアウトが崩れない（レスポンシブ）
