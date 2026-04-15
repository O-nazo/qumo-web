# Intro Quiz Workbench

`IntroQuiz` の問題CSVを楽に作るための、別起動のワークベンチです。

## できること

- YouTube / YouTube Music のプレイリストURLから問題行を生成
- CSVの読み込み / 編集 / 書き出し
- 指定したローカルCSVへの自動上書き保存
- YouTubeを内蔵プレイヤーで再生
- 現在再生位置を `startAt` / `chorusAt` にワンクリック記録
- `Wikipedia検索` / `YouTube検索` を現在曲のタイトルとアーティストで即オープン

## 起動

ブラウザ版:

```bash
npm run intro-workbench
```

起動後、ブラウザで `http://localhost:4315` を開いてください。

Electron版:

```bash
npm run intro-workbench:electron
```

ウィンドウを閉じるとアプリも終了します。

## EXE発行

Windows向けEXE:

```bash
npm run intro-workbench:dist:win
```

出力先は `dist_intro_workbench/` です。

## 自動保存の使い方

1. 保存先にCSVフルパスを入れる
2. 既存ファイルなら `パスから開く`
3. 新規作成ならプレイリスト生成後に `自動保存を有効化`
4. 以後は編集のたびに同じファイルへ上書き保存される

## 補足

- ブラウザの `CSVを開く` は中身だけ読み込むため、元ファイルの場所は分かりません。自動保存したい場合は保存先パスの設定が必要です。
- `year` の自動取得は YouTube Music 由来の情報がある場合のみ入ります。
- 通常の YouTube URL やローカル音源でもCSVは編集できますが、内蔵プレイヤーでの秒数打ちは YouTube URL のときだけ対応しています。
