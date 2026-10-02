# deterministic-replay

好きな画像から、パーツが集まって絵が完成する動画を作れます。正方形の画像に対応した静的Webアプリ。物理シミュレーションが順方向に進んで画像が揃う様子をループでプレビューできる。パーツの形状や動きはシーンごとに定義する。Vite、Three.js / TSL、Rapier3D、Mediabunnyを使用する。

公開ページ: [Deterministic replay](https://novogrammer.github.io/deterministic-replay/)

シーンは平行投影・ライトなしと、透視投影・ライトありの2種類を切り替えられる。各シーンは`SimulationScene`と`SceneSettings`をimplementsする独立したクラスとして、構築処理・物理設定・ベイクJSONを持つ。継承関係は設けない。

各シーンは`PhysicsDefinition`を通してWorld・Collider・投入方法を構築する。共通の`PhysicsSimulation`が固定ステップ、投入時刻、姿勢取得、リセットを管理し、球体以外の形状にも同じ再生・ベイクの仕組みを使える。

一つ目のシーンは、440個の球体を浅い正方形の容器へ流し込む「Square tray」。固定カメラから見た完成時に画像が揃う。最終姿勢だけを開発時にMatrix4としてベイクし、途中の動きは再生時にRapierで計算する。UVは最終Matrix4からTSLで求める。

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

`npm run bake`は登録済みシーンの最終姿勢とメタデータを各シーンの`src/scenes/<scene-id>/bake.json`へ保存する。`npm run bake -- square-tray`で一つのシーンを指定できる。物理設定やRapierを変更したら再ベイクする。画像の差し替えでは不要。途中の軌道は保存しない。

正方形のPNG・JPEG・WebPを選択して使用する。画像を選ぶ前はサンプルを表示する。1,024または512ピクセル四方、30または60fpsでH.264 / MP4を書き出せる。エンコードに対応するブラウザが必要。プレビューと出力は同じ`SceneRuntime`の順方向更新と描画を使い、`SessionController`が排他制御する。seekは設けない。録画後は先頭へ戻り、録画前の再生／一時停止状態を引き継ぐ。

描画先は共通のRenderTargetで、プレビューはそのテクスチャを表示する。録画はRenderTargetから読み出したフレームごとのRGBAデータをMediabunnyへ渡す。

未ベイクのJSONは`{"formatVersion":1,"bake":null}`を置く。単色でシミュレーションでき、画像投影と「完成を見る」はベイク後に有効になる。JSONはシーンから直接importする。

## 構成

- `src/scenes/`: シーンの実装とファクトリー登録。一つ目は`SquareTrayScene`で、Scene・World・InstancedMesh・TSLを所有する。
- `src/simulation/`: シーン内部で使う物理計算。
- `src/replay/`: シーン内部で使う最終データの検証と順方向の前後2姿勢の保持。
- `src/player/`: SceneRuntimeの時間管理・共通描画、PreviewPlayerの時計、SessionControllerのモード制御。
- `src/export/`: VideoRecorderによるRGBAフレームのエンコードとMP4生成。
- `scripts/bake.ts`: 開発用ベイク。

シーンを追加するときは`SimulationScene`を実装したクラスの生成ファクトリーを`SceneRegistry`へ登録し、`src/index.html`の選択肢を追加してベイクする。詳しくは[設計書](docs/design.md)を参照。

Viteのルートは`src/`、静的アセットは`public/`、出力は`dist/`。パスは`import.meta.url`から解決し、ビルドでは`emptyOutDir: true`で出力を更新する。UIのHTMLノードは`src/index.html`に記述し、JavaScriptで追加しない。SCSSはBEMを使用する。TypeScriptはクラスを基本とし、計算や変換には関数も使う。

GitHub Pagesへの公開は[デプロイ用ワークフロー](.github/workflows/deploy.yaml)で行う。`main`へのpushまたは手動実行でビルドした`dist/`を公開する。公開ページのフッターから[GitHubリポジトリ](https://github.com/novogrammer/deterministic-replay)へ移動できる。
