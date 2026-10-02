# 決定論的リプレイによる画像生成動画の設計

更新日: 2026-10-02

## 目的と基本方針

正方形の画像をパーツ群の表面へ投影し、パーツが集まる順再生の動画を生成する。動いている間は画像の断片が散らばって見え、最後にパーツが落ち着くと、完成時の視点から画像が揃って見える。現在のSquare trayでは球体を浅い容器へ投入するが、共通の物理・再生処理は形状や投入方法を限定しない。

各パーツの最終姿勢だけを開発時にMatrix4としてベイクする。途中の動きやUVはベイクしない。公開ページでは同じ初期条件からRapierを固定ステップで進め、現在姿勢を計算する。最終姿勢へ強制移動したり、逆再生したりしない。

Viteによる静的ページとして構成し、GitHub Pagesで配信する。画像の処理、物理計算、プレビュー、MP4生成はブラウザ内で完結する。

## 技術構成と実装方針

| 技術 | 役割 |
| --- | --- |
| Vite / TypeScript | 静的ビルドとアプリの構成 |
| Three.js / InstancedMesh | パーツ群、容器、カメラの描画 |
| WebGPURenderer / TSL | 最終姿勢からの投影UV計算と画像サンプリング |
| rapier3d-deterministic-compat | 決定論的な固定ステップの物理計算 |
| Mediabunny / WebCodecs | RenderTargetから読み出したRGBAフレームをH.264でエンコードしMP4を生成 |

状態やリソースの所有者はクラスとする。計算や変換には関数も使う。不要な継承階層は作らない。

HTMLノードはcanvas、入力、ダウンロードリンクも含めて`src/index.html`に記述する。JavaScriptでノードを生成・追加せず、既存ノードへのイベント登録と値・表示状態の更新を行う。SCSSのUIクラスはBEMを使い、`body`などの要素セレクタはリセット用途で使う。

表示名は「Deterministic replay」。`public/images/replay.svg`を文字なしのfaviconとヘッダーのアイコンに使い、同じ図形を持つ`public/images/replay-sample.svg`を初期画像に使う。紙のようなオフホワイト（`#F5F5F2`）の背景に青灰色の8×8の正方形グリッドを画像の端まで置く。積み上がりの早い段階から模様が見えるよう、余白を設けず線のコントラストを確保する。濃いネイビーのY軸は横方向の中央に置き、座標の原点は画像中央から2マス下（SVG座標で`512, 768`）に置く。グリッドはこの原点から上下左右へ続き、コーラルの放物線と、終点にある黄色の丸で構成する。丸は軌道を進んだ後に止まった位置を表し、最終姿勢で画像が揃うアプリの表現と対応させる。グリッドは座標空間、放物線は運動軌道、丸は球体を表す。faviconには文字を入れず、小さいアイコンでも図形を読み取りやすくする。初期画像は上部中央に青色（`#2563EB`）の「REPLAY」を置く。文字はHelvetica Boldの輪郭をSVGのpathとして保存し、実行環境のフォントに依存しない。文字の縁に背景色を細く入れ、グリッドと重なっても読み取れるようにする。

Viteのルートは`src/`、静的アセットは`public/`、出力は`dist/`。パスは`fileURLToPath(new URL('./src', import.meta.url))`の形式で解決する。`emptyOutDir: true`でビルドする。

## 設計判断の理由

状態とリソースを、その振る舞いを担うクラスが所有する。各シーンはThree.jsのScene、カメラ、RapierのWorldと描画オブジェクトを構築し、更新・リセット・解放まで担当する。外側はシーン固有の容器や投入方法を知らずに操作できる。設定値も各シーン自身が`SceneSettings`をimplementsして持ち、別の設定クラスへ分離しない。

各シーンを独立した変更単位として扱う。二つのSquare trayシーンでは現在、容器の形や物理条件、計算結果が同じだが、それは現在の実装の結果である。将来、一方の容器や投入方法を変えるときに他方まで変わる構造にはしない。共通インターフェイスは呼び出し方を揃えるための契約であり、シーン同士の継承、設定の共有、ベイクファイルの共有を意味しない。コードや結果が似ているという理由だけで共通化しない。

ベイクJSONは各シーンに属するデータとして扱い、シーンごとにimport先、識別情報、出力先を持つ。結果が同じ値になっても独立してベイクする。確認するのは各シーンの再現性と自身の保存データとの整合性であり、シーン間の結果の一致を維持するテストは設けない。未ベイク状態は`bake: null`で明示し、架空の最終姿勢を使わずにシーンを開発できるようにする。未ベイクの球体は識別しやすいマゼンタ（`#ff00ff`）で描画する。

再生と録画は同じシーンの更新・描画を使うが、時計とエンコードの責務は分ける。SessionControllerが実行モードを排他的に制御することで、プレビューの時計が録画中の状態を更新することを防ぐ。録画へ渡す画素は独立したCPUバッファとして確定させ、描画用GPUバッファの再利用とエンコード処理の寿命を切り離す。

途中の動きを保存せず、固定初期条件から順方向に計算することで、プレビューと録画に同じ進行方法を使う。最終Matrix4だけを保存すれば、画像を差し替えても物理の再ベイクは不要になる。UVはTSLで最終Matrix4と完成時カメラから計算し、画像と物理データを独立して扱う。

設定パネルのh2は「好きな画像から、パーツが集まって絵が完成する動画を作れます」という簡潔な説明にする。形状や動きはシーンごとに異なるため、球体や積み重なりに限定しない。装飾的な番号や重複する説明文は置かない。

シーンの見出しと選択肢の名前は「Square tray · 平行投影」「Square tray · 透視投影＋ライト」「Torus knot pile · 透視投影＋ライト」に揃える。見出し上はシーン番号だけを表示し、アプリ名を重複して表示しない。球体数と容器の説明、フッターのキャッチコピー、再生方式が共通であることを示す「LOOP」バッジ、ヘッダーの「PHYSICS / IMAGE / MOTION」は表示しない。

## 一つ目のシーン: Square tray

上から球体が流れ込む、正面から見た浅い正方形の容器。前後の透明な衝突壁によって球体がほぼ一層に並び、完成画像が読みやすくなる。前後の壁は描画せず、底と左右の枠を描く。

| 設定 | 初期値 |
| --- | --- |
| 球体数 / 半径 | 440 / 0.2 |
| 画像領域の幅・高さ | 8 × 8 |
| 容器の奥行き | 0.44 |
| 物理タイムステップ | 1 / 60秒 |
| 投入 | 10球ずつ、10ステップ間隔 |
| 完成時カメラ | 正面の固定平行投影、範囲9.4 × 9.4 |
| 終了条件 | 全球体の投入後、全RigidBodyがsleeping |
| 計算上限 | 1,200ステップ。未収束ならベイク失敗 |
| ベイク時の終了ステップ | 568（約9.47秒） |
| 完成状態の保持 | 2秒。1周期は約11.47秒 |

これらは最初のシーンの調整値。別シーンでは設定を変えられる。冒頭に上方を向くカメラ演出は、今後の候補とする。

## 三つ目のシーン: Torus knot pile

広い床の中央へTorusKnotを落とし、山状に積み重ねる。周囲に衝突壁を設けず、パーツは自然に転がって広がる。固定の透視投影カメラで斜め上から眺め、DirectionalLightとHemisphereLight、MeshStandardNodeMaterialで描画する。床とパーツは影を受け、パーツは影を落とす。穴とパーツ間の隙間は残り、入力画像で埋めない。

| 設定 | 値 |
| --- | --- |
| シーンID / パーツ数 | torus-knot-pile / 180 |
| Geometry | TorusKnotGeometry(0.28, 0.09, 96, 12, 2, 3) |
| スケール | Geometryが実寸、インスタンスのスケールは1 |
| 床 / 衝突壁 | 20 × 20、床面y=0。外周の衝突壁は設けない |
| 投入位置 | xz=(-0.65,-0.65)、(0.65,-0.65)、(0,0.65)、各軸±0.1のばらつき |
| 投入高さ / 間隔 | y=7〜7.18、3個ずつ10ステップ間隔 |
| 初速 / 回転 | 下向き0.2、固定シードのQuaternionと各軸±0.5の角速度 |
| シード / 固定ステップ | 20261002 / 1/60秒 |
| 摩擦 / 反発 | 0.65 / パーツ0.04、床と壁0 |
| damping / solver | linear 0.18、angular 0.55 / 8 iterations、CCD有効 |
| カメラ | 位置(8,9,11)、注視点(0,0.35,0)、画角40度 |
| 画像領域 | 画面中央の正方形、画面幅の62％ |
| 影 | PCF、2048 × 2048、強度0.35、normalBias 0.025 |
| 終了条件 / 上限 | 全投入後に全Bodyがsleeping / 1,800ステップ |
| ベイク終了 / 保持 | 991ステップ（約16.52秒） / 2秒、1周期約18.52秒 |

山を中央へ大きく収めるため、初期案のカメラ位置(10,11,14)、注視点(0,1.5,0)、画像幅70％から上記へ調整した。カメラは再生中に動かさない。画像の上端など、山の表面が存在しない領域には断片が現れない。

TorusKnotPileSceneは既存の構築契約を使う独立したクラスで、専用物理クラスは設けない。Geometryのposition属性をFloat32Arrayとしてメモリに保持し、createBody()でRapierのconvexHullへ渡す。凸包では形状の穴を埋めて衝突判定する。頂点のJSON保存や生成スクリプトは作らず、Nodeのベイクとブラウザで同じ構築処理を使う。

自身のディレクトリからbake.jsonをimportする。settingsKeyには形状のパラメーター・分割数、個数、シード、投入位置・高さ・間隔、重力・solver・摩擦・反発・damping・CCD、床Collider、終了上限を含める。固定の物理ロジックを変更するときはrevisionを更新する。UV・途中姿勢・凸包頂点はベイクJSONに含めない。

SceneRuntimeはshadowMapを有効化し、影を使うライトとMeshはシーン自身が設定する。プレビューと録画は同じRenderTargetへ影を含めて描画する。シーン切り替え時はWorld、Geometry、Material、InstancedMeshに加えてLightShadowのリソースも解放する。既存のSquare trayには影を落とすライトを追加しない。

ベイクは `npm run bake -- torus-knot-pile` でこのシーンだけ実行できる。

## 複数シーンの構成

| 型・クラス | 責務 |
| --- | --- |
| SimulationScene | Three.jsのScene・カメラとRapierのWorldを所有するシーンの共通インターフェイス |
| SceneSettings | 各シーン自身がimplementsする識別情報・個数・時間設定・settingsKey。球体や容器固有の設定は含めない |
| PhysicsDefinition | 各シーン自身がimplementsするWorld構築・Body構築・インスタンスID別の投入ステップの契約 |
| SquareTrayScene | 容器・球体・物理の構築、固定ステップ、リセット、補間、TSL、最終姿勢のベイク |
| SceneRegistry | シーンのファクトリーとベイク出力先の登録、一覧、インスタンス生成 |
| PhysicsSimulation | Worldの寿命管理、投入スケジュールの実行、固定ステップ、姿勢取得、sleep判定、リセット。形状や容器は知らない |
| SeededRandom | リセット時に初期化する固定シードの乱数。各シーンのBody構築へ渡す |
| ReplayData | 各シーン内部で使うベイク検証と前後2姿勢の保持。ファイル取得は行わない |
| SceneRuntime | シーンの時間管理、step/reset/updateViewへの委譲、renderer・RenderTarget・画素読み出し |
| PreviewPlayer | rAFの時計、再生・一時停止。描画や録画について知らない |
| VideoRecorder | 渡されたRGBAフレームのエンコード、MP4生成。物理や時刻進行を制御しない |
| SessionController | モード切り替え、描画の排他制御、ループ、録画のフレーム時刻と進捗・キャンセル |
| App | 静的HTMLの操作、シーン・画像・出力設定の変更 |

シーン追加時は`SimulationScene`を実装するクラスを作り、生成ファクトリーを`SceneRegistry`へ登録し、`src/index.html`の選択肢を追加する。各シーンがThree.jsのSceneとRapierのWorldを構築・所有し、`step()`で固定時間刻みを進め、`reset()`で初期状態に戻す。描画用の補間は`updateView(alpha)`で行う。各シーンは自由に容器や投入方法を実装できる。

各シーンは`PhysicsDefinition`もimplementsする。`createWorld()`で重力、solver設定、床・壁などの静的Colliderを構築し、`createBody(world, id, random)`でインスタンスIDに対応するRigidBodyとColliderを構築してBodyを返す。渡された固定シードの乱数を使い、シーンにリセットが必要な乱数状態を持たせない。`spawnSteps`はID順の整数ステップ配列とし、IDの順と投入時刻の順は一致しなくてよい。同じステップの投入はID順に行う。

`PhysicsSimulation`はこの契約を受け取り、Worldのタイムステップを設定し、投入を実行する。姿勢は投入順ではなくインスタンスID順に書き出し、未投入の姿勢はゼロにする。全インスタンスが投入され、全Bodyがsleepingになるまで収束とは判定しない。リセット時には旧Worldを解放し、シーンの構築処理を再実行して乱数を初期化する。球体Collider、容器の寸法、重力、摩擦、初速、batchSizeなどの値は共通処理に置かない。

`ReplayData.fromBake()`は`SceneSettings`と`PhysicsDefinition`を満たすシーンを受け取る。シーン自身の`settingsKey`と投入ステップを使って保存データを検証し、`PhysicsSimulation`で前後2姿勢を保持する。`settingsKey`はシーンが自身の物理設定をJSON文字列化して返すgetterとする。各シーンは物理結果に影響する設定を含める。今回の責務移動ではSquare trayのキー内容・順序と物理条件を維持し、既存のベイクJSONを引き続き使う。

今後TorusKnotなどの形状を追加する場合も専用の物理クラスは増やさず、この構築契約を使う。凸包Collider用の頂点はScene構築時にGeometryから取り出し、実行中のメモリだけで扱う。凸包頂点のJSONや事前生成スクリプトは追加せず、ベイクとブラウザが同じ構築処理を実行する。形状生成を含む再現性は、各シーンの再生結果と自身のベイクデータで確認する。

一つ目の実装とベイクJSONは`src/scenes/square-tray/`に置く。JSONはクラスから直接importし、実行時にfetchしない。切り替え時には旧シーンのWorld、geometry、materialなどを解放し、選択したシーンの再生時刻を先頭へ戻す。画像と出力設定はRuntimeで共有する。

未ベイクのJSONは`{"formatVersion":1,"bake":null}`とする。ダミーの最終Matrix4は作らない。この状態でもシーンを構築・ステップ更新・リセットでき、球体は単色で表示する。画像投影と「完成を見る」はベイク後に利用できる。未ベイク時のプレビューの計算区間には、そのシーンの最大ステップ数を使う。

`SquareTrayScene`と`SquareTrayPerspectiveScene`はそれぞれ`SimulationScene`を実装する独立したクラスで、継承関係を持たない。各シーン自身が`SceneSettings`もimplementsし、物理設定をreadonlyフィールドとして持つ。構築処理と設定値は各シーンのディレクトリに置く。透視投影版は専用の`src/scenes/square-tray-perspective/bake.json`をimportする。各シーンは独立したシーンIDとベイク出力先を持つ。現在は結果の最終Matrix4が同じ値になるが、その一致をシーン間の制約にはしない。ファイルは共有しない。固定したPerspectiveCamera、DirectionalLight、HemisphereLightとMeshStandardNodeMaterialを使う。画像UVはそのカメラの最終view-projectionから求める。平行投影版の法線による簡易陰影は従来どおり残し、透視投影版はライトで陰影を付ける。

## 開発時のベイク

```sh
npm run bake                 # 登録されている全シーン
npm run bake -- square-tray  # 指定シーンのみ
```

Node.js 22.6以降でTypeScriptを実行するローカルスクリプト。未ベイク状態のシーンを生成し、その`bake()`を呼ぶ。公開ページと同じ内部の物理実装で、固定シードと固定ステップで収束まで計算する。保存済みデータが古くても再ベイクできる。JSONの`bake`へ結果を書き込み、次の読み込みで画像投影が有効になる。保存するのは次のデータのみ。

- データ形式バージョン、シーンID、revision、設定識別情報、Rapierバージョン。
- パーツ数、タイムステップ、終了ステップ、収束状態、各パーツの出現ステップ。
- インスタンスID順の最終Matrix4。各16成分、Three.jsのcolumn-major順。

最終Matrix4には位置、回転、描画用スケールを含める。途中の位置・回転、動画フレーム、UV、入力画像の色は保存しない。

入力画像の変更では再ベイクしない。物理設定、球体数・半径、投入順、初期条件、乱数、終了条件、Rapierの変更時は再ベイクする。共通シミュレーションの物理定数やロジックを変更した場合はシーンのrevisionも上げる。カメラや画像領域だけを変える場合は、物理結果を再利用できる。

公開ページでは設定識別情報とRapierバージョンなどを照合し、不一致なら再ベイクを求める。終了ステップで再計算した姿勢とベイク済みMatrix4も比較し、ずれを強制移動で補正しない。

## 順方向の更新と共通描画

任意時刻へのseekと操作用タイムラインは設けない。操作は再生・一時停止・先頭から再開・完成を見る。

`SceneRuntime.advance(deltaSeconds)`で時間を前へ進め、固定の物理ステップまで計算する。各シーンの`step()`を必要な回数呼ぶ。シーン内部で前後2ステップ分の位置とQuaternionだけを一時保持し、位置を線形補間、回転をslerpして現在のインスタンス行列へ反映する。`SceneRuntime.render()`はその状態を描画する。全時系列の姿勢配列や過去へ戻るための再計算は作らない。

先頭からの再開とループでは`reset()`でWorldと乱数を初期状態へ戻す。未出現の球体は描画しない。終了ステップ以降は物理計算を進めず、その姿勢で完成状態を保持する。1周期は落下・収束と保持区間の合計で、保持後に先頭へ戻るカットを許容する。

「完成を見る」はベイク済みMatrix4を直接表示する専用操作。シミュレーションを終端まで進める操作ではない。この表示から再生する場合は先頭へ戻す。通常の順再生の終端では、物理結果と保存済みMatrix4を比較し、保存値への強制移動で補正しない。

`SessionController`をシーンの更新・描画の唯一の入口とする。プレビューでは`PreviewPlayer`のrAF時計から届く時間差を使う。Rapierのタイムステップ自体は1/60秒で固定する。録画ではSessionControllerがフレームnの時刻`n / FPS`を決め、前フレームからの差分だけ前進させ、描画を待ってVideoRecorderへ渡す。VideoRecorderはシーンやプレイヤーに依存しない。

recordまたは設定変更のモードに入ると、プレビューのrAF予約を止め、進行中の描画が終わるまで待つ。record中はプレビュー操作や設定変更を受け付けない。物理World・InstancedMesh・renderer・canvasは共有し、各モードをSessionControllerで排他的に動かす。

録画の完了・キャンセル・失敗時には、レコーダーを閉じてシーンを先頭へリセットし、描画が終わってからpreviewモードへ戻す。録画前の再生／一時停止状態を引き継ぐ。以前の再生位置へ戻すseekは行わない。設定変更では現在の物理状態を保って再描画し、シーン変更では初期状態へ戻す。

## 最終姿勢からの投影UV

各インスタンスの最終Matrix4を、4列のvec4インスタンス属性としてGPUへ渡す。440球なら行列本体は28,160バイト。JSONファイルにはテキスト化による増加がある。

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

入力はsRGB。上下方向を揃えて読み込み、画像領域外はTSLのUV範囲判定でシーンのclear色と同じ色にする。テクスチャ自体は既定のClampToEdgeWrappingだが、範囲外の色はこの判定で置き換える。Square trayは上部まで球体を積むため440球とし、画像の上端を越えた部分もカメラ内に残してclear色で表示する。透視投影のシーンも現時点では440球とする。個数の設定とベイクデータは各シーンが独立して持つ。範囲外の色には陰影やライトの影響を加えず、背景と色を揃える。球体の形が見える程度の弱い陰影を付ける。球体間の隙間や枠による遮蔽は残る。

## 決定論と検証

同じRapierバージョン、設定、初期条件、追加順から同じ物理結果を得ることを前提とする。乱数は固定シードのxorshift、投入時刻は整数ステップとし、初期条件の生成にMath.sin / Math.cosなどの超越関数を使わない。[Rapier: Determinism](https://rapier.rs/docs/user_guides/javascript/determinism/)

依存バージョンはロックファイルで管理する。ローカルテストではリセット後の途中姿勢、終了姿勢とベイクデータ、設定変更の検出、モードの排他制御、録画終了・キャンセル・失敗後の状態を確認する。共通物理処理は球体以外のCollider、不規則な投入時刻、ID順と異なる投入順、未投入Bodyによる早期収束の防止も確認する。ブラウザでも終端のMatrix4を比較する。異なるGPUでのピクセル値やエンコーダーによるMP4のバイト列の完全一致は要件にしない。

## canvasとMP4

canvasは出力動画と同じ正方形の描画解像度にする。初期値は1,024 × 1,024、512 × 512も選択可能。`renderer.setPixelRatio(1)`と`renderer.setSize(size, size, false)`を使い、画面への縮小表示はCSSで行う。画面リサイズや端末のDPRでは描画バッファを変えない。

Mediabunnyの`Output`、`Mp4OutputFormat`、`VideoSampleSource`を使い、H.264 / MP4、30または60fps、high品質で出力する。エンコード可否を先に確認し、未対応なら理由を表示する。[Media sources](https://mediabunny.dev/guide/media-sources)、[Writing media files](https://mediabunny.dev/guide/writing-media-files)

プレビュー・録画ともに同じRGBA8/sRGBのRenderTargetへ描画し、そのテクスチャをcanvasに表示する。録画時は`readRenderTargetPixelsAsync`でCPUへ読み出し、行のパディングと上下方向を補正した独立したRGBAバッファを`VideoSample`として渡す。GPUからCPUへの転送コストは生じるが、canvasの描画バッファの寿命に依存せず、フレームの画素を確定させられる。PNG化やbase64化は行わない。

出力フレーム数は`ceil(周期秒数 × FPS)`。各フレームの長さは`1 / FPS`。順方向更新、描画、画素の読み出し、`VideoSampleSource.add`を順に待って次のフレームへ進む。サンプルは追加完了後に閉じる。実時間の録画ではない。完成状態の保持区間を含む1周期を出力し、動画内には先頭へ戻るカットを入れない。

MP4はメモリ上で生成し、HTMLに用意したダウンロードリンクから保存する。進捗表示とキャンセルに対応する。大きな画像・動画では画像、GPU、MP4バッファのメモリ消費を考慮する。

## 公開と今後の検討

公開先は[GitHub Pages](https://novogrammer.github.io/deterministic-replay/)。Viteのbaseは`./`とし、静的ファイルの取得は`import.meta.env.BASE_URL`を使う。現在のRapier compatはWASMを同梱する。[Vite: Deploying a Static Site](https://vite.dev/guide/static-deploy.html)

OGP画像は`public/images/ogp.png`（1200×630）。Square trayの完成状態のキャンバスを左に置き、右にアプリ名と「好きな画像から、パーツが集まって絵が完成する動画を作れます」を載せる。背景はページと同じ暗色。完成状態は録画と同じRenderTargetのRGBA読み出しを使い、文字と合成して直接PNGに保存する。JPEGスクリーンショットやJPEGからの変換を経由しない。`src/index.html`にOpen Graphと大きな画像を使うTwitter Cardのメタタグを置き、画像URLはGitHub Pagesの絶対URLを指定する。

`.github/workflows/deploy.yaml`が`main`へのpushまたは手動実行でビルドし、`dist/`をGitHub Pagesへ公開する。READMEに公開ページへのリンクを置き、公開ページのフッターに[GitHubリポジトリ](https://github.com/novogrammer/deterministic-replay)へのテキストリンクを置く。

今後は別の容器・投入方式、カメラ演出、Worker化、大きな出力の保存方法、対応ブラウザの範囲を検討する。非正方形の画像は現状拒否し、クロップは実装しない。

### SNS向け動画の色設定と投稿後の変換

現時点では動画の出力設定を維持する。入力のVideoSampleはRGBA/sRGB、BT.709原色、RGB行列、フルレンジとする。確認したMP4（`tmp/scene-refactor-check/result.mp4`）はH.264 High、8bit YUV 4:2:0、`pix_fmt=yuvj420p`、`color_range=pc`、BT.709原色・行列、sRGB伝達特性だった。ブラウザやエンコーダーが変わった場合の出力は別途確認する。

今後はXなどへのアップロード可否に加え、投稿前後の色・レンジ・解像度・画質を比較する。X側の再エンコードを避けられることは保証しない。SNSとの互換性を優先する候補として、初回の書き出しからリミテッドレンジのYUV 4:2:0とBT.709伝達特性へ揃える方法を検討する。変更時はsRGBの入力画素を正しく変換し、メタ情報だけの変更や、生成済みMP4の不要な再エンコードは避ける。

[X公式の広告仕様](https://help.x.com/en/business-and-advertising/creative-ad-specifications)はMP4/MOV、H.264、4:2:0を推奨するが、フル／リミテッドレンジの指定はない。[YouTube公式のアップロード設定](https://support.google.com/youtube/answer/1722171?hl=ja)はSDRのBT.709を推奨し、フルレンジをリミテッドレンジへ、sRGB伝達特性をBT.709へ変換すると説明している。YouTubeの仕様をXの仕様とは扱わず、一般的な互換性を検討する参考とする。
