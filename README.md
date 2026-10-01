# deterministic-replay

正方形の画像を読み込み、球体が容器へ流れ込む順再生をループプレビュー・MP4として出力する静的Webアプリ。Vite、Three.js / TSL、Rapier3D、Mediabunnyを使用する。

一つ目のシーンは、400個の球体を浅い正方形の容器へ流し込む「Square tray」。固定カメラから見た完成時に画像が揃う。最終姿勢だけを開発時にMatrix4としてベイクし、途中の動きは再生時にRapierで計算する。UVは最終Matrix4からTSLで求める。

## 開発

Node.js 22.6以降を使用する。

```sh
npm install
npm run dev
npm run bake
npm test
npm run build
npm run preview
```

`npm run bake`は登録済みシーンの最終姿勢とメタデータを`public/scenes/<scene-id>/bake.json`へ保存する。`npm run bake -- square-tray`で一つのシーンを指定できる。物理設定やRapierを変更したら再ベイクする。画像の差し替えでは不要。途中の軌道は保存しない。

正方形のPNG・JPEG・WebPを選択して使用する。画像を選ぶ前はサンプルを表示する。1,024または512ピクセル四方、30または60fpsでH.264 / MP4を書き出せる。エンコードに対応するブラウザが必要。プレビューと出力は同じ`SceneRuntime`の順方向更新と描画を使い、`SessionController`が排他制御する。seekは設けない。録画後は先頭へ戻り、録画前の再生／一時停止状態を引き継ぐ。

## 構成

- `src/scenes/`: シーン定義と登録。一つ目は`SquareTrayScene`。
- `src/simulation/`: ベイクとブラウザで共有する物理計算。
- `src/replay/`: 最終データの検証と指定時刻までの再計算。
- `src/player/`: SceneRuntimeの物理状態更新・描画、PreviewPlayerの時計、SessionControllerのモード制御。
- `src/export/`: VideoRecorderによるフレーム取得・エンコードとMP4生成。
- `scripts/bake.ts`: 開発用ベイク。

シーンを追加するときは定義クラスを`SceneRegistry`へ登録し、`src/index.html`の選択肢を追加してベイクする。詳しくは[設計書](docs/design.md)を参照。

Viteのルートは`src/`、静的アセットは`public/`、出力は`dist/`。パスは`import.meta.url`から解決し、ビルドでは`emptyOutDir: true`で出力を更新する。UIのHTMLノードは`src/index.html`に記述し、JavaScriptで追加しない。SCSSはBEMを使用する。TypeScriptはクラスを基本とし、計算や変換には関数も使う。

GitHub Pagesへの公開は未設定。公開先に応じてViteのbaseと配信手順を設定する。
