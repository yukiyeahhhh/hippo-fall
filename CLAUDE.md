# どうぶつポトン（hippo-fall）— プロジェクトメモ

このリポジトリで作業するAI/人が最初に読む前提情報。特に「公開のしくみ」は
チャットをまたぐと食い違いやすいので、ここを正とする。

## 公開（本番URL）

- **本番URL（一般公開版）＝ https://hippo-fall.pages.dev**
  - ホスティングは **Cloudflare Pages**。GitHubリポジトリ `yukiyeahhhh/hippo-fall` と連携。
  - ⚠️ **GitHubのURL（github.com/... や raw, GitHub Pages）は公開版ではない**。
    一般ユーザーに渡す/インスタbioに貼るのは必ず `pages.dev` の方。

## デプロイのしくみ（重要）

- **Cloudflare Pages は `master` ブランチを監視**している。
- **`master` に push した瞬間に自動でビルド＆公開**される（1〜2分で反映）。
  - = `master` への push は「即・一般公開」を意味する。**push前に必ず本人に確認**。
- **`master` 以外のブランチを push すると、Cloudflareがプレビュー専用URLを自動発行**。
  - 本番(master)を汚さずに「公開前の実機テスト」ができる。ブラッシュアップ中はこれを使う。

### ブランチの使い分け
- `master` … 公開中の本番（ライブURLに出ているもの）
- 作業/ブラッシュアップ用ブランチ … WIP。完成したら `master` に反映して公開。

## フィードバック導線

- 集客は **インスタのリール（縦動画）を主役**に想定。Xは補助。
  - インスタはキャプション内リンク不可 → **プロフィールのbioリンク**に `pages.dev` を貼る運用。
- ゲーム内に「**💬 感想を送る**」ボタンを設置済み（タイトル画面＋ゲーム終了画面）。
  - リンク先 Googleフォーム: https://forms.gle/Q12ew2W9Xh6ttDBz6
  - 実装箇所: `index.html`（タイトルのボタン群）, `game.html`（#overlay のシェア下）, `style.css`（`.fb-btn`）

## 構成メモ

- ビルド不要の静的Webゲーム（HTML/CSS/JS）。Cloudflare Pagesのビルド設定は
  **Build command＝空 / Output directory＝`/`**。
- PWA対応の `manifest.json` あり（ホーム画面に追加可能）。
