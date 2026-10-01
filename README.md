# deterministic-replay

正方形の画像を読み込み、球体が容器へ流れ込む順再生の物理シミュレーションを、ループプレビューとMP4として楽しむ静的Webアプリ。

初めは球体の表面に画像の断片が散らばって見え、球体が最終配置へ落ち着くと、完成時のカメラから元の画像が揃って見える。

Vite、Three.js / TSL、Rapier3D、Mediabunnyを使用し、GitHub Pagesで公開する予定。

シーンごとの最終姿勢は開発時にMatrix4としてベイクして静的データとして持たせる。入力画像に依存しない姿勢データを再利用し、UVは描画時にTSLで計算する。

## 設計

[設計書](docs/design.md)に、確定事項、処理の流れ、投影UV、リプレイと動画出力の方針、未決定事項をまとめている。

Vite＋TypeScriptの初期構成を準備済み。シミュレーション、描画、動画出力の実装と公開設定はまだ行っていない。

## 開発

```sh
npm run dev
npm run build
npm run preview
```

Viteのルートは`src/`で、HTMLエントリーは`src/index.html`。静的アセットはリポジトリ直下の`public/`、ビルド出力はリポジトリ直下の`dist/`を使う。各パスは`import.meta.url`を基準に絶対パスへ解決する。ビルド時は`emptyOutDir: true`で`dist/`の既存の出力ファイルを削除してから生成する。
