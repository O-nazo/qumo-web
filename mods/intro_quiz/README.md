# IntroQuiz

イントロクイズ用の MOD です。

## できること

- 問題セットの読み込み
- イントロ再生
- 自動停止
- リワインド
- サビ頭キュー再生
- 判定時の自動停止
- ローカル音源 / 直 URL / YouTube の再生
- シンプルな CSV ベースの問題管理

## 問題セット

`assets/sets/*.csv` を読み込みます。

ローカル音源は `assets/library/` 配下に置き、`path` に相対パスを書きます。

## CSV 列

- `id`
- `title`
- `artist`
- `year`
- `note`
- `path`
- `startAt`
- `chorusAt`

## 自動処理

- `answer` は `title / artist` から自動生成します。
- `type` は `path` から自動判定します。
- YouTube は `path` にフル URL を入れてください。
- `stopAfterSec` は CSV からは受け取らず、現在は既定値で自動停止します。
