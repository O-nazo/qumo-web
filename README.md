# QUMO-WEB-SYS クモノス

![クモノスLogo](public/logo/Logo_hor.png)

クモノスは、演出・ビジュアルに特化した早押しクイズ運営ツールです。
1台の運営PCで進行画面と表示画面を立ち上げ、参加者はスマートフォンやPCのブラウザから参加できます。

このツールは、以下のような用途を想定しています。

- 早押しクイズ大会の運営
- 配信企画やイベントでのクイズ進行
- 通話セッションでの早押しクイズ
- オフライン会場での参加型クイズ
- 身内向けの対戦や練習会

## このツールでできること

クモノスでは、クイズ運営に必要な画面と機能をまとめて扱えます。

- 基本的な早押しクイズのシステムを搭載
- スコアや回答をリアルタイムでグラフィカルに表示
- スマホ・タブレットからQRコードで簡単参加
- ルールの詳細な変更
- MODによる問題形式・画面演出の追加
- 設定やルールのプリセット保存・選択

## 画面のしくみ

クモノスは、主に 3 つの画面で動きます。

### 1. Controller

運営者が操作する画面です。

この画面では、以下のような操作を行います。

- 問題を出す
- 正解・誤答・スルーを判定する
- プレイヤーの状態や得点を確認する
- ルールや表示方法を切り替える
- 参加用 QR コードを表示する
- MOD を切り替える

### 2. Visualizer

会場や配信に表示するための画面です。

この画面には、以下の情報を表示できます。

- プレイヤー一覧
- 得点や順位
- 押下順や状態
- ルール説明
- 問題演出や MOD ごとの表示内容

運営者は Controller を操作し、Visualizer は「見せる専用画面」として使います。

### 3. Player

参加者が使う画面です。

参加者はスマートフォンやPCのブラウザからアクセスし、以下のように使います。

- 名前を入力して参加する
- 早押しボタンを押す
- ボード解答モード時に回答を送信する
- 自分の状態やスコアを確認する

## システム構成

クモノスは、見た目はデスクトップアプリですが、中では Web 技術を使って動いています。  
利用者目線では、「運営PCが小さなサーバー役になり、各画面を同期している」と考えると分かりやすいです。

### どう動いているか

1. 運営PCで クモノスを起動します
2. 運営PCの中でローカルサーバーが立ち上がります
3. Controller と Visualizer の画面が開きます
4. 参加者は運営PCが表示した URL または QR コードから Player 画面にアクセスします
5. 参加者の操作内容はリアルタイムで運営画面と表示画面に反映されます

### ポイント

- 運営PCが中心になります
- 参加者側には専用アプリのインストールは不要です
- 参加者はブラウザだけで参加できます
- 画面間の状態はリアルタイムで同期されます

### ネットワークについて

基本的には、運営PCと参加者端末が同じネットワークに接続されていれば利用できます。  
また、設定によっては外部公開用の URL を使って参加させる運用も可能です。

## 搭載機能

### クイズ進行

- 早押し受付
- 押下順の管理
- 正解 / 誤答 / スルー判定
- 問題ごとのリセット
- 自動進行設定

### プレイヤー管理

- 参加者一覧の表示
- プレイヤー名の変更
- スコア管理
- 正解数 / 誤答数 / 休み回数の管理
- 並び順の調整

### ルール設定

- 早押しルールの切り替え
- 得点条件の設定
- 勝ち抜け条件 / 失格条件の設定
- 表示用ルール説明の切り替え

### 表示機能

- スコア表示の ON / OFF
- 各種カウント表示の切り替え
- プレイヤーパネルのレイアウト変更
- ルールオーバーレイ表示
- 得点非表示モード
- タイトル画面表示

### 接続補助

- 参加 URL の表示
- QR コード表示
- リアルタイム同期

### 設定保存

- ルール設定の保存
- UI 設定の保存
- プリセットの書き出し / 読み込み

## MOD について

クモノスは MOD に対応しています。  
MOD を使うことで、問題形式に応じた専用画面や専用進行を追加できます。

現在は以下のような MOD を利用できます。

- IntroQuiz
  - イントロクイズ向け
- SprintVision
  - 画像・映像を使う視覚問題向け
- Time Race
  - タイマー進行を重視した形式向け

各 MOD の詳しい使い方や仕様は、別ページで説明します。

## 使い始めるまでの流れ

初めて使う場合は、まず以下の流れをイメージしてください。

1. クモノスを起動する
2. Controller 画面でルールや表示設定を確認する
3. Visualizer 画面を外部モニターや配信用画面に出す
4. Player 用の URL または QR コードを参加者に案内する
5. 参加者が接続したら、Controller から進行を始める

## 使い方

### 起動

アプリを起動すると、通常は以下の画面が立ち上がります。

- Controller
- Visualizer

### 参加者の接続

Controller 画面で参加用の URL または QR コードを表示し、参加者に案内します。  
参加者はブラウザから Player 画面にアクセスし、名前を入力して参加します。

### 問題進行

問題進行は Controller 画面から行います。

基本的な流れは以下の通りです。

1. 問題を出す
2. 参加者が Player 画面から早押しする
3. 回答者が決まる
4. Controller で判定する
5. 次の問題へ進む

### 表示

Visualizer は、会場スクリーンや配信画面に映す用途で使用します。  
プレイヤー情報やスコア、問題演出などを見せるための画面です。

## 導入方法

### 配布版を使う場合

配布された実行ファイルを起動してください。  
通常は追加のセットアップなしで利用できます。

### ソースコードから起動する場合

Node.js と npm が必要です。

```bash
npm install
npm start
```

開発用に起動する場合は、必要に応じて以下を使用します。

```bash
npm run dev
```

## 動作環境

想定環境の例です。

- Windows
- Node.js / npm が利用できる環境（ソース起動時）
- 同一ネットワーク上で接続可能な端末
- 参加者側はモダンブラウザ

## ディレクトリ概要

主なディレクトリは以下の通りです。

- `electron/`
  - デスクトップアプリとして起動するための処理
- `server/`
  - 状態管理、通信、進行ロジック
- `public/`
  - Controller / Visualizer / Player の基本画面
- `mods/`
  - 問題形式ごとの拡張機能
- `config/`
  - 保存した設定やプリセット

## こんな人に向いています

- クイズ大会を PC 1 台でまとめて運営したい人
- 参加者はスマホ、運営は PC で進めたい人
- 問題形式ごとに画面や進行を切り替えたい人
- 配信や会場イベントで使えるクイズシステムを探している人

## 注意事項

- ネットワーク環境によっては接続の安定性に影響があります
- 一部機能は利用する MOD によって挙動が異なります
- MOD の詳細仕様は別ドキュメントを参照してください

## 連絡先
- X(旧Twitter） @Oh_Citlus
- メールアドレス qumo-web★o-nazo.com (★を@に変えてください)
## ライセンス

MIT License

Copyright (c) 2026 O-nazo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

SE・BGM・フォント等各アセットの著作権は著作者に帰属します。