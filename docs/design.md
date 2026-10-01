# 決定論的リプレイによる画像生成動画の設計

更新日: 2026-10-02

## 目的と基本方針

正方形の画像を球体群の表面へ投影し、球体が容器へ流れ込む順再生の動画を生成する。動いている間は画像の断片が散らばって見え、最後に球体が落ち着くと、完成時の視点から画像が揃って見える。

各球体の最終姿勢だけを開発時にMatrix4としてベイクする。途中の動きやUVはベイクしない。公開ページでは同じ初期条件からRapierを固定ステップで進め、現在姿勢を計算する。最終姿勢へ強制移動したり、逆再生したりしない。

Viteによる静的ページとして構成し、GitHub Pagesで配信する想定。画像の処理、物理計算、プレビュー、MP4生成はブラウザ内で完結する。

## 技術構成と実装方針

| 技術 | 役割 |
| --- | --- |
| Vite / TypeScript | 静的ビルドとアプリの構成 |
| Three.js / InstancedMesh | 球体群、容器、カメラの描画 |
| WebGPURenderer / TSL | 最終姿勢からの投影UV計算と画像サンプリング |
| rapier3d-deterministic-compat | 決定論的な固定ステップの物理計算 |
| Mediabunny / WebCodecs | canvasのフレームをH.264でエンコードしMP4を生成 |

状態やリソースの所有者はクラスとする。計算や変換には関数も使う。不要な継承階層は作らない。

HTMLノードはcanvas、入力、ダウンロードリンクも含めて`src/index.html`に記述する。JavaScriptでノードを生成・追加せず、既存ノードへのイベント登録と値・表示状態の更新を行う。SCSSのUIクラスはBEMを使い、`body`などの要素セレクタはリセット用途で使う。

Viteのルートは`src/`、静的アセットは`public/`、出力は`dist/`。パスは`fileURLToPath(new URL('./src', import.meta.url))`の形式で解決する。`emptyOutDir: true`でビルドする。

## 一つ目のシーン: Square tray

上から球体が流れ込む、正面から見た浅い正方形の容器。前後の透明な衝突壁によって球体がほぼ一層に並び、完成画像が読みやすくなる。前後の壁は描画せず、底と左右の枠を描く。

| 設定 | 初期値 |
| --- | --- |
| 球体数 / 半径 | 400 / 0.2 |
| 画像領域の幅・高さ | 8 × 8 |
| 容器の奥行き | 0.44 |
| 物理タイムステップ | 1 / 60秒 |
| 投入 | 10球ずつ、10ステップ間隔 |
| 完成時カメラ | 正面の固定平行投影、範囲9.4 × 9.4 |
| 終了条件 | 全球体の投入後、全RigidBodyがsleeping |
| 計算上限 | 1,200ステップ。未収束ならベイク失敗 |
| ベイク時の終了ステップ | 511（約8.52秒） |
| 完成状態の保持 | 2秒。1周期は約10.52秒 |

これらは最初のシーンの調整値。別シーンでは設定を変えられる。冒頭に上方を向くカメラ演出は、今後の候補とする。

## 複数シーンの構成

| 型・クラス | 責務 |
| --- | --- |
| SceneDefinition | ID、revision、初期条件、容器、カメラ、保持時間の定義 |
| SquareTrayScene | 一つ目のシーンの具体的な設定 |
| SceneRegistry | シーンの登録、一覧、IDからの取得 |
| PhysicsSimulation | 共通の物理World、投入、固定ステップ、初期状態へのリセット |
| ReplayData | ベイク結果の検証、固定ステップでの前進、前後2姿勢の保持 |
| SceneRuntime | 物理状態の前進・リセット、姿勢補間、TSL、描画。更新と描画を分ける |
| PreviewPlayer | rAFの時計、再生・一時停止。描画や録画について知らない |
| VideoRecorder | 完成したフレームの取得・エンコード、MP4生成。物理や時刻進行を制御しない |
| SessionController | モード切り替え、描画の排他制御、ループ、録画のフレーム時刻と進捗・キャンセル |
| App | 静的HTMLの操作、シーン・画像・出力設定の変更 |

シーン追加時は`SceneDefinition`を実装するクラスを作り、`SceneRegistry`へ登録し、`src/index.html`の選択肢を追加してベイクする。シーンごとに`public/scenes/<scene-id>/bake.json`を持つ。切り替え時には旧シーンのWorld、geometry、materialなどを解放し、選択したシーンの再生時刻を先頭へ戻す。画像と出力設定は共有する。

現在の共通シミュレーションは上方からの球体投入を担当する。砂時計や別の投入方法に広げる際は、シーン定義と共通シミュレーションの責務を拡張する。

## 開発時のベイク

```sh
npm run bake                 # 登録されている全シーン
npm run bake -- square-tray  # 指定シーンのみ
```

Node.js 22.6以降でTypeScriptを実行するローカルスクリプト。公開ページと同じ`PhysicsSimulation`を使い、固定シードと固定ステップで収束まで計算する。保存するのは次のデータのみ。

- データ形式バージョン、シーンID、revision、設定識別情報、Rapierバージョン。
- 球体数、タイムステップ、終了ステップ、収束状態、各球体の出現ステップ。
- インスタンスID順の最終Matrix4。各16成分、Three.jsのcolumn-major順。

最終Matrix4には位置、回転、半径のスケールを含める。途中の位置・回転、動画フレーム、UV、入力画像の色は保存しない。

入力画像の変更では再ベイクしない。物理設定、球体数・半径、投入順、初期条件、乱数、終了条件、Rapierの変更時は再ベイクする。共通シミュレーションの物理定数やロジックを変更した場合はシーンのrevisionも上げる。カメラや画像領域だけを変える場合は、物理結果を再利用できる。

公開ページでは設定識別情報とRapierバージョンなどを照合し、不一致なら再ベイクを求める。終了ステップで再計算した姿勢とベイク済みMatrix4も比較し、ずれを強制移動で補正しない。

## 順方向の更新と共通描画

任意時刻へのseekと操作用タイムラインは設けない。操作は再生・一時停止・先頭から再開・完成を見る。

`SceneRuntime.advance(deltaSeconds)`で時間を前へ進め、固定の物理ステップまで計算する。前後2ステップ分の位置とQuaternionだけを一時保持し、位置を線形補間、回転をslerpして現在のインスタンス行列へ反映する。`SceneRuntime.render()`はその状態を描画する。全時系列の姿勢配列や過去へ戻るための再計算は作らない。

先頭からの再開とループでは`reset()`でWorldと乱数を初期状態へ戻す。未出現の球体は描画しない。終了ステップ以降は物理計算を進めず、その姿勢で完成状態を保持する。1周期は落下・収束と保持区間の合計で、保持後に先頭へ戻るカットを許容する。

「完成を見る」はベイク済みMatrix4を直接表示する専用操作。シミュレーションを終端まで進める操作ではない。この表示から再生する場合は先頭へ戻す。通常の順再生の終端では、物理結果と保存済みMatrix4を比較し、保存値への強制移動で補正しない。

`SessionController`をシーンの更新・描画の唯一の入口とする。プレビューでは`PreviewPlayer`のrAF時計から届く時間差を使う。Rapierのタイムステップ自体は1/60秒で固定する。録画ではSessionControllerがフレームnの時刻`n / FPS`を決め、前フレームからの差分だけ前進させ、描画を待ってVideoRecorderへ渡す。VideoRecorderはシーンやプレイヤーに依存しない。

recordまたは設定変更のモードに入ると、プレビューのrAF予約を止め、進行中の描画が終わるまで待つ。record中はプレビュー操作や設定変更を受け付けない。物理World・InstancedMesh・renderer・canvasは共有し、各モードをSessionControllerで排他的に動かす。

録画の完了・キャンセル・失敗時には、レコーダーを閉じてシーンを先頭へリセットし、描画が終わってからpreviewモードへ戻す。録画前の再生／一時停止状態を引き継ぐ。以前の再生位置へ戻すseekは行わない。設定変更では現在の物理状態を保って再描画し、シーン変更では初期状態へ戻す。

## 最終姿勢からの投影UV

各インスタンスの最終Matrix4を、4列のvec4インスタンス属性としてGPUへ渡す。400球なら行列本体は25,600バイト。JSONファイルにはテキスト化による増加がある。

TSLで球体のローカル表面座標を最終Matrix4で変換し、完成時カメラから投影する。

```text
pLocal      = geometryのposition属性（現在姿勢による変換前）
pFinalWorld = finalInstanceMatrix[id] × vec4(pLocal, 1)
pClip       = finalProjectionMatrix × finalViewMatrix × pFinalWorld
uvScreen    = (pClip.xy / pClip.w) × 0.5 + 0.5
uvImage     = (uvScreen - imageRegionMin) / imageRegionSize
surfaceColor = sample(inputImage, uvImage)
```

現在のInstancedMeshのワールド変換はidentityとする。親の変換を追加する場合は、現在姿勢と最終姿勢の座標系も揃える。

TSLの`positionLocal`はインスタンス描画で更新されるため、最終姿勢の計算では生の`attribute('position', 'vec3')`を使う。頂点で求めたclip座標をvaryingとして渡し、フラグメントで透視除算と画像領域への変換を行う。UVを属性やテクスチャとして保存しない。

描画位置には現在姿勢を使い、画像の投影には最終姿勢を使う。これにより模様が球体表面に付いて動き、終端で各断片がつながる。球体中心だけのサンプリングにはしない。最終回転も保持する。

入力はsRGB。上下方向を揃えて読み込み、画像領域外は灰色にする。球体の形が見える程度の弱い陰影を付ける。球体間の隙間や枠による遮蔽は残る。

## 決定論と検証

同じRapierバージョン、設定、初期条件、追加順から同じ物理結果を得ることを前提とする。乱数は固定シードのxorshift、投入時刻は整数ステップとし、初期条件の生成にMath.sin / Math.cosなどの超越関数を使わない。[Rapier: Determinism](https://rapier.rs/docs/user_guides/javascript/determinism/)

依存バージョンはロックファイルで管理する。ローカルテストではリセット後の途中姿勢、終了姿勢とベイクデータ、設定変更の検出、モードの排他制御、録画終了・キャンセル・失敗後の状態を確認する。ブラウザでも終端のMatrix4を比較する。異なるGPUでのピクセル値やエンコーダーによるMP4のバイト列の完全一致は要件にしない。

## canvasとMP4

canvasは出力動画と同じ正方形の描画解像度にする。初期値は1,024 × 1,024、512 × 512も選択可能。`renderer.setPixelRatio(1)`と`renderer.setSize(size, size, false)`を使い、画面への縮小表示はCSSで行う。画面リサイズや端末のDPRでは描画バッファを変えない。

Mediabunnyの`Output`、`Mp4OutputFormat`、`VideoSampleSource`を使い、H.264 / MP4、30または60fps、high品質で出力する。エンコード可否を先に確認し、未対応なら理由を表示する。[Media sources](https://mediabunny.dev/guide/media-sources)、[Writing media files](https://mediabunny.dev/guide/writing-media-files)

プレビュー・録画ともに同じRGBA8/sRGBのRenderTargetへ描画し、そのテクスチャをcanvasに表示する。録画時は`readRenderTargetPixelsAsync`でCPUへ読み出し、行のパディングと上下方向を補正した独立したRGBAバッファを`VideoSample`として渡す。GPUからCPUへの転送コストは生じるが、canvasの描画バッファの寿命に依存せず、フレームの画素を確定させられる。PNG化やbase64化は行わない。

出力フレーム数は`ceil(周期秒数 × FPS)`。各フレームの長さは`1 / FPS`。順方向更新、描画、画素の読み出し、`VideoSampleSource.add`を順に待って次のフレームへ進む。サンプルは追加完了後に閉じる。実時間の録画ではない。完成状態の保持区間を含む1周期を出力し、動画内には先頭へ戻るカットを入れない。

MP4はメモリ上で生成し、HTMLに用意したダウンロードリンクから保存する。進捗表示とキャンセルに対応する。大きな画像・動画では画像、GPU、MP4バッファのメモリ消費を考慮する。

## 公開と今後の検討

GitHub Pagesのリポジトリ配下へ公開する場合は、Viteのbaseを公開先に合わせる。静的ファイルの取得は`import.meta.env.BASE_URL`を使う。現在のRapier compatはWASMを同梱する。[Vite: Deploying a Static Site](https://vite.dev/guide/static-deploy.html)

公開先、ビルド・配信手順は未設定。外部サービスの変更、デプロイ、pushは今回の実装に含めない。

今後は別の容器・投入方式、カメラ演出、Worker化、大きな出力の保存方法、対応ブラウザの範囲を検討する。非正方形の画像は現状拒否し、クロップは実装しない。
